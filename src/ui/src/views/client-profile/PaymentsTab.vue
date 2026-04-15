<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Payments</div>
      <router-link :to="`/payments/${contactId}`" class="btn btn-sm btn-secondary">Full Payment Page</router-link>
    </div>

    <!-- Card on file -->
    <div class="card mb-4">
      <div class="card-title">Card on File</div>
      <div v-if="enrollmentInfo?.cardOnFile" class="text-sm">
        <strong>{{ enrollmentInfo.cardOnFile.brand || 'Card' }}</strong>
        ending in {{ enrollmentInfo.cardOnFile.last4 }}
        <span class="text-muted">(exp {{ enrollmentInfo.cardOnFile.expMonth }}/{{ enrollmentInfo.cardOnFile.expYear }})</span>
      </div>
      <div v-else class="text-sm text-muted">No card on file</div>
      <div v-if="enrollmentInfo?.dunningActive" class="text-sm mt-2" style="color:#ef4444;font-weight:500">
        Dunning active — failed payment being retried.
      </div>
    </div>

    <!-- Totals + installment / subscription -->
    <div class="card mb-4">
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
      <div v-if="enrollmentInfo?.paymentType === 'installments' || enrollmentInfo?.paymentType === 'installment'" class="text-sm mt-2">
        <strong>Installment Progress:</strong>
        {{ enrollmentInfo.paymentsMade || 0 }} of {{ enrollmentInfo.paymentsTotal || '?' }} payments made
        <span v-if="enrollmentInfo.installmentAmount" class="text-muted">
          (${{ Number(enrollmentInfo.installmentAmount).toFixed(2) }} / {{ enrollmentInfo.installmentFrequency || 'month' }})
        </span>
      </div>
      <div v-if="enrollmentInfo?.paymentType === 'subscription'" class="text-sm mt-2">
        <strong>Subscription:</strong>
        ${{ Number(enrollmentInfo.installmentAmount || enrollmentInfo.paymentAmount || 0).toFixed(2) }} /
        {{ enrollmentInfo.installmentFrequency || 'month' }} (ongoing)
      </div>
    </div>

    <!-- Recent payments (compact) -->
    <div class="card">
      <div class="card-title">Recent Payments</div>
      <div v-if="loading" class="text-sm text-muted">Loading...</div>
      <div v-else-if="error" class="text-sm" style="color:#ef4444">{{ error }}</div>
      <div v-else-if="recentPayments.length === 0" class="text-sm text-muted">No payments yet.</div>
      <table v-else class="table">
        <thead>
          <tr><th>Date</th><th>Amount</th><th>Type</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in recentPayments" :key="p.id">
            <td class="text-sm">{{ formatDate(p.date) }}</td>
            <td class="text-sm">${{ Number(p.amount).toFixed(2) }}</td>
            <td>
              <span class="badge" :class="p.type === 'refund' ? 'badge-red' : 'badge-green'">
                {{ p.type === 'refund' ? 'Refund' : 'Charge' }}
              </span>
            </td>
            <td>
              <span class="badge" :class="p.status === 'success' ? 'badge-green' : 'badge-red'">
                {{ p.status === 'success' ? 'Paid' : 'Failed' }}
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
import { ref, onMounted } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  contactId: string;
  enrollmentInfo: any;
}>();

const api = useApi();

const recentPayments = ref<any[]>([]);
const loading = ref(false);
const error = ref('');

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
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
