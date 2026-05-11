<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Payments</div>
      <router-link :to="`/payments/${contactId}`" class="btn btn-sm btn-secondary">Full Payment Page</router-link>
    </div>

    <!-- Card on file -->
    <div class="card">
      <div class="card-title">Card on File</div>
      <div v-if="enrollmentInfo?.cardOnFile" class="text-sm">
        <strong>{{ cardLabel(enrollmentInfo.cardOnFile) }}</strong>
        <span v-if="enrollmentInfo.cardOnFile.last4"> ending in {{ enrollmentInfo.cardOnFile.last4 }}</span>
        <span v-if="hasExpiry(enrollmentInfo.cardOnFile)" class="text-muted">(exp {{ enrollmentInfo.cardOnFile.expMonth }}/{{ enrollmentInfo.cardOnFile.expYear }})</span>
      </div>
      <div v-else class="text-sm text-muted">No card on file</div>
      <div v-if="enrollmentInfo?.dunningActive" class="text-sm mt-2" style="color:#ef4444;font-weight:500">
        Dunning active — failed payment being retried.
      </div>
    </div>

    <!-- Totals -->
    <div class="card">
      <div class="card-title">Totals</div>
      <div class="grid grid-3 mt-2">
        <div class="text-sm">
          <strong>Total Charged:</strong> ${{ Number(enrollmentInfo?.totalCharged || 0).toFixed(2) }}
        </div>
        <div class="text-sm" v-if="Number(enrollmentInfo?.totalRefunded || 0) > 0">
          <strong>Total Refunded:</strong> ${{ Number(enrollmentInfo?.totalRefunded || 0).toFixed(2) }}
        </div>
        <div class="text-sm">
          <strong>Last Payment:</strong> {{ enrollmentInfo?.lastPaymentDate ? formatDate(enrollmentInfo.lastPaymentDate) : 'N/A' }}
        </div>
      </div>
    </div>

    <!-- Per-program installment / subscription progress -->
    <div v-if="activeRecurringEnrollments.length > 0" class="card">
      <div class="card-title">Program Payment Progress</div>
      <div
        v-for="enr in activeRecurringEnrollments"
        :key="enr.id"
        class="program-progress-card"
      >
        <div class="program-progress-header">
          <strong class="text-sm">{{ enr.offerName }}</strong>
          <span class="badge badge-blue text-xs">{{ enr.paymentType === 'subscription' ? 'Subscription' : 'Installments' }}</span>
        </div>
        <div v-if="enr.paymentType !== 'subscription'" class="text-sm mt-1">
          {{ enr.paymentsMade || 0 }} of {{ enr.paymentsTotal || '?' }} paid
          <span v-if="enrProgramTotal(enr) > 0">
            · ${{ enrAmountPaid(enr) }} of ${{ enrProgramTotal(enr).toFixed(2) }}
          </span>
        </div>
        <div v-else class="text-sm mt-1">
          ${{ Number(enr.installmentAmount || enr.paymentAmount || 0).toFixed(2) }} /
          {{ enr.installmentFrequency || 'month' }} (ongoing)
        </div>
        <div v-if="enr.installmentAmount && enr.paymentType !== 'subscription'" class="text-muted text-xs" style="margin-top:2px">
          ${{ Number(enr.installmentAmount).toFixed(2) }} per {{ enr.installmentFrequency || 'month' }}
        </div>
        <div v-if="enr.nextBillingDate" class="text-muted text-xs" style="margin-top:2px">
          Next: {{ formatDateShort(enr.nextBillingDate) }}
        </div>
        <!-- Progress bar for installments -->
        <div v-if="enr.paymentType !== 'subscription' && enr.paymentsTotal" class="progress-bar-wrapper mt-1">
          <div class="progress-bar" :style="{ width: progressPct(enr) + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- Recent payments -->
    <div class="card">
      <div class="card-title">Recent Payments</div>
      <div v-if="loading" class="text-sm text-muted">Loading...</div>
      <div v-else-if="error" class="text-sm" style="color:#ef4444">{{ error }}</div>
      <div v-else-if="recentPayments.length === 0" class="text-sm text-muted">No payments yet.</div>
      <table v-else class="table">
        <thead>
          <tr><th>Date</th><th>Program</th><th>Amount</th><th>Billing</th><th>Processor</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in recentPayments" :key="p.id">
            <td class="text-sm">{{ formatDate(p.date) }}</td>
            <td class="text-sm">
              {{ p.programName || 'Unassigned payment' }}
              <div v-if="p.paymentNumber" class="text-xs text-muted">
                Payment {{ p.paymentNumber }}<span v-if="p.paymentsRemaining === 0">, final</span>
              </div>
            </td>
            <td class="text-sm">${{ Number(p.amount).toFixed(2) }}</td>
            <td>
              <span class="badge badge-gray">{{ p.paymentTypeLabel || p.type }}</span>
            </td>
            <td>
              <span class="badge" :class="processorBadge(p.processor)">
                {{ processorLabel(p.processor) }}
              </span>
            </td>
            <td>
              <span class="badge" :class="paymentStatusBadge(p)">
                {{ p.statusLabel || (p.status === 'success' ? 'Paid' : 'Failed') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="recentPayments.length >= 5" class="text-sm mt-2">
        <router-link :to="`/payments/${contactId}`" style="color:#3b82f6">View full history →</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  contactId: string;
  enrollmentInfo: any;
  enrollments?: any[];
}>();

function cardLabel(card: any) {
  const processor = processorLabel(card?.processorType);
  const brand = card?.brand || 'Card on file';
  return `${processor} ${brand}`.trim();
}

function hasExpiry(card: any) {
  return Number(card?.expMonth || 0) > 0 && Number(card?.expYear || 0) > 0;
}

const api = useApi();

const recentPayments = ref<any[]>([]);
const loading = ref(false);
const error = ref('');

/** Filter enrollments to active installment/subscription programs */
const activeRecurringEnrollments = computed(() => {
  if (!props.enrollments?.length) return [];
  return props.enrollments.filter(e => {
    const status = String(e.status || '').toLowerCase();
    const type = String(e.paymentType || '').toLowerCase();
    const isActive = ['enrolled', 'active', 'consent_captured'].includes(status);
    const isRecurring = ['installments', 'installment', 'subscription'].includes(type);
    return isActive && isRecurring;
  });
});

function enrProgramTotal(enr: any): number {
  const total = Number(enr.paymentsTotal || 0);
  const amt = Number(enr.installmentAmount || 0);
  return total > 0 && amt > 0 ? total * amt : 0;
}

function enrAmountPaid(enr: any): string {
  const paid = Number(enr.paymentsMade || 0);
  const amt = Number(enr.installmentAmount || 0);
  return (paid * amt).toFixed(2);
}

function progressPct(enr: any): number {
  const made = Number(enr.paymentsMade || 0);
  const total = Number(enr.paymentsTotal || 1);
  return Math.min(100, Math.round((made / total) * 100));
}

function processorLabel(proc: string): string {
  if (proc === 'nmi') return 'NMI';
  if (proc === 'stripe') return 'Stripe';
  if (proc === 'ghl') return 'GHL';
  return proc || 'Unknown';
}

function processorBadge(proc: string): string {
  if (proc === 'nmi') return 'badge-blue';
  if (proc === 'stripe') return 'badge-purple';
  if (proc === 'ghl') return 'badge-gray';
  return 'badge-gray';
}

function paymentStatusBadge(payment: any): string {
  if (payment?.type === 'refund') return 'badge-yellow';
  if (payment?.status === 'failed') return 'badge-red';
  return 'badge-green';
}

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDateShort(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

onMounted(async () => {
  loading.value = true;
  try {
    const data = await api.get<any>(`/api/payments/manage/customer/${props.contactId}`);
    recentPayments.value = (data?.payments || []).slice(0, 5);
  } catch (e: any) {
    error.value = e.message || 'Failed to load payments';
  }
  loading.value = false;
});
</script>

<style scoped>
.program-progress-card {
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
}
.program-progress-card:last-child {
  border-bottom: none;
}
.program-progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-bar-wrapper {
  height: 6px;
  background: var(--ss-navy-200);
  border-radius: 9999px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--ss-primary-500);
  border-radius: 9999px;
  transition: width 0.3s ease;
}
.text-xs {
  font-size: 12px;
}
</style>
