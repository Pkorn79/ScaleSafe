<template>
  <div>
    <div class="flex-between mb-4">
      <div>
        <h1 class="page-title" style="margin-bottom:4px">{{ clientLabel }}</h1>
        <p v-if="clientEmail" class="text-sm text-muted">{{ clientEmail }}</p>
      </div>
      <router-link to="/payments" class="btn btn-secondary">Back</router-link>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="actionError" class="error-msg">{{ actionError }}</div>

    <!-- Dunning Alert Banner -->
    <div v-if="dunningEvent" class="card" :style="{ borderLeft: '4px solid ' + (dunningEvent.dunning_status === 'escalated' ? '#ef4444' : '#f59e0b') }">
      <div class="flex-between">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:8px">
            Dunning Active
            <span class="badge" :class="dunningEvent.dunning_status === 'escalated' ? 'badge-red' : 'badge-yellow'">
              {{ dunningEvent.dunning_status }}
            </span>
          </div>
          <div class="text-sm text-muted" style="margin-top:4px">
            Retry {{ dunningEvent.dunning_retry_count || 0 }} of 3
            <span v-if="dunningEvent.dunning_next_retry"> - Next retry: {{ formatDate(dunningEvent.dunning_next_retry) }}</span>
          </div>
          <div v-if="dunningEvent.dunning_status === 'escalated'" class="text-sm" style="color:#ef4444;margin-top:4px;font-weight:500">
            Max retries reached - contact is delinquent. Request a payment method update or escalate manually.
          </div>
        </div>
        <button v-if="dunningEvent.dunning_status !== 'resolved'" class="btn btn-sm btn-primary" @click="retryDunning" :disabled="dunningRetrying">
          {{ dunningRetrying ? 'Retrying...' : 'Retry Now' }}
        </button>
      </div>
      <div v-if="dunningResult" class="text-sm" :style="{ color: dunningResult.success ? '#10b981' : '#ef4444', marginTop: '8px' }">
        {{ dunningResult.success ? 'Payment succeeded! Dunning resolved.' : dunningResult.error }}
      </div>
    </div>

    <!-- Saved Payment Methods -->
    <div class="card">
      <div class="flex-between">
        <div class="card-title">Saved Payment Methods</div>
      </div>
      <div v-if="cardUpdateResult" class="text-sm mt-2" :style="{ color: '#10b981' }">{{ cardUpdateResult }}</div>
      <div v-if="defaultMethodLabel" class="text-sm text-muted mt-2">
        Payment method update links replace the current default: {{ defaultMethodLabel }}.
      </div>
      <div class="text-sm text-muted mt-2">
        Create update links from the specific recurring plan below so the link uses that program's processor.
      </div>
      <div v-if="methods.length === 0" class="text-sm text-muted">No saved payment methods.</div>
      <div v-for="m in methods" :key="m.id" class="flex-between" style="padding:8px 0;border-bottom:1px solid #f3f4f6">
        <div>
          <strong>{{ cardLabel(m) }}</strong>
          <span v-if="m.isDefault" class="badge badge-blue" style="margin-left:6px">Default</span>
          <div v-if="m.detailLabel" class="text-xs text-muted">{{ m.detailLabel }}</div>
          <div v-if="m.hiddenDuplicateCount" class="text-xs text-muted">
            {{ m.hiddenDuplicateCount }} older saved version{{ m.hiddenDuplicateCount === 1 ? '' : 's' }} hidden
          </div>
        </div>
        <div class="flex gap-2">
          <button v-if="!m.isDefault" class="btn btn-sm btn-secondary" @click="setDefaultCard(m.id)" :disabled="cardActionLoading">
            Set Default
          </button>
          <button class="btn btn-sm btn-secondary" style="color:#ef4444" @click="removeCard(m)" :disabled="cardActionLoading">
            Remove
          </button>
        </div>
      </div>
    </div>

    <!-- Subscription Status (recurring plans only - installments + subscriptions) -->
    <div v-if="recurringEnrollments.length > 0" class="card">
      <div class="card-title">Recurring Plans</div>
      <div v-for="enr in recurringEnrollments" :key="enr.id" class="recurring-plan">
        <div>
          <div class="recurring-title">
            <strong>{{ enr.offerName || 'Program' }}</strong>
            <span class="badge badge-gray">{{ paymentTypeLabel(enr.paymentType) }}</span>
            <span class="badge" :class="processorBadge(enr.processorType)">{{ processorLabel(enr.processorType) }}</span>
            <span class="badge" :class="statusBadge(enr.status)">{{ enr.status }}</span>
          </div>
          <div class="text-sm text-muted mt-1">
            <span v-if="enr.processorSubscriptionId">Subscription ID: {{ enr.processorSubscriptionId }}</span>
            <span v-else>No processor subscription ID on file</span>
          </div>
          <div class="text-sm text-muted mt-1">
            <span v-if="enr.cardOnFile">Payment method: {{ enr.cardOnFile.displayLabel }}</span>
            <span v-else-if="String(enr.processorType || '').toLowerCase() === 'whop'">Payment method: Whop checkout</span>
            <span v-else>Payment method: not linked to this processor</span>
            <span v-if="enr.cardOnFile?.detailLabel"> - {{ enr.cardOnFile.detailLabel }}</span>
          </div>
          <div v-if="enr.billingIssue" class="text-xs control-warning mt-1">
            {{ enr.billingIssue.label }}
          </div>
          <div v-else-if="!enr.controlVerified" class="text-xs control-warning mt-1">
            Subscription ID missing; billing controls may only update ScaleSafe.
          </div>
          <div class="text-sm text-muted mt-1">
            <span v-if="enr.paymentType !== 'subscription'">
              {{ enr.paymentsMade || 0 }} of {{ enr.paymentsTotal || '?' }} payments made
              <span v-if="paymentsRemaining(enr) !== null"> - {{ paymentsRemaining(enr) }} remaining</span>
            </span>
            <span v-else>Ongoing subscription</span>
            <span v-if="enr.nextBillingDate"> - Next billing {{ formatDateShort(enr.nextBillingDate) }}</span>
          </div>
        </div>
        <div class="flex gap-2">
          <button v-if="canRequestPaymentUpdate(enr)" class="btn btn-sm btn-secondary" @click="copyCardUpdateLink(enr)" :disabled="cardUpdateSending">
            Copy Update Link
          </button>
          <button v-if="canRequestPaymentUpdate(enr)" class="btn btn-sm btn-secondary" @click="sendCardUpdateRequest(enr)" :disabled="cardUpdateSending">
            {{ cardUpdateSending ? 'Sending...' : 'Request Payment Update' }}
          </button>
          <button v-if="canPause(enr)" class="btn btn-sm btn-secondary" @click="openPause(enr)">
            Pause
          </button>
          <button v-if="canResume(enr)" class="btn btn-sm btn-primary" @click="resumeEnrollment(enr)" :disabled="subLoading">
            {{ subLoading ? 'Resuming...' : 'Resume' }}
          </button>
          <button v-if="canCancel(enr)" class="btn btn-sm btn-danger" @click="openCancel(enr)">
            Cancel
          </button>
        </div>
      </div>
      <div v-if="subResult" class="text-sm" :style="{ color: '#10b981', marginTop: '8px' }">{{ subResult }}</div>
    </div>

    <!-- Quick Actions -->
    <div class="flex gap-2 mb-4">
      <button class="btn btn-primary" @click="showChargeModal = true" :disabled="methods.length === 0">
        + Charge Saved Method
      </button>
      <span v-if="methods.length === 0" class="text-sm text-muted" style="align-self:center">No saved payment method - send an update request first</span>
    </div>

    <!-- Payment History -->
    <div class="card">
      <div class="card-title">Payment History</div>
      <div v-if="payments.length === 0 && !loading" class="text-sm text-muted">No payments found.</div>
      <table v-if="payments.length > 0" class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Program</th>
            <th>Amount</th>
            <th>Billing</th>
            <th>Processor</th>
            <th>Status</th>
            <th>Dunning</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td>{{ formatDate(p.date) }}</td>
            <td>
              {{ p.programName || 'Unassigned payment' }}
              <div v-if="p.paymentNumber" class="text-sm text-muted">
                Payment {{ p.paymentNumber }}<span v-if="p.paymentsRemaining === 0">, final</span>
              </div>
            </td>
            <td>${{ p.amount.toFixed(2) }}</td>
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
            <td>
              <span v-if="p.dunningStatus" class="badge" :class="p.dunningStatus === 'resolved' ? 'badge-green' : p.dunningStatus === 'escalated' ? 'badge-red' : 'badge-yellow'">
                {{ p.dunningStatus }}
              </span>
            </td>
            <td>
              <button v-if="p.refundable" class="btn btn-sm btn-secondary"
                @click="openRefund(p)">Refund</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="payments.length > 0" class="flex gap-4 mt-4 text-sm">
        <span>Total charged: <strong>${{ totalCharged.toFixed(2) }}</strong></span>
        <span>Total refunded: <strong>${{ totalRefunded.toFixed(2) }}</strong></span>
      </div>
    </div>

    <!-- Charge Modal -->
    <Modal v-model:open="showChargeModal" title="One-Time Charge">
      <div class="form-group">
        <label class="form-label">Payment Method</label>
        <select class="form-select" v-model="chargeForm.methodId">
          <option v-for="m in methods" :key="m.id" :value="m.id">
            {{ cardOptionLabel(m) }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Amount ($)</label>
        <input class="form-input" type="number" step="0.01" min="0.01" v-model.number="chargeForm.amount" />
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" v-model="chargeForm.description" placeholder="e.g., Additional session" />
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showChargeModal = false">Cancel</button>
        <button class="btn btn-primary" @click="submitCharge" :disabled="chargeLoading">
          {{ chargeLoading ? 'Processing...' : 'Charge Payment Method' }}
        </button>
      </template>
    </Modal>

    <!-- Refund Modal -->
    <Modal v-model:open="showRefundModal" title="Issue Refund">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">Original charge: ${{ refundForm.originalAmount.toFixed(2) }}</p>
      <div class="form-group">
        <label class="form-label">Refund Amount ($)</label>
        <input class="form-input" type="number" step="0.01" min="0.01"
          :max="refundForm.originalAmount" v-model.number="refundForm.amount" />
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" @change="refundForm.amount = refundForm.originalAmount" />
          Full refund (${{ refundForm.originalAmount.toFixed(2) }})
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Reason</label>
        <input class="form-input" v-model="refundForm.reason" placeholder="Client requested refund" />
      </div>
      <p class="text-sm text-muted">Refunds may take 5-10 business days to process.</p>
      <template #footer>
        <button class="btn btn-secondary" @click="showRefundModal = false">Cancel</button>
        <button class="btn btn-danger" @click="submitRefund" :disabled="refundLoading">
          {{ refundLoading ? 'Processing...' : 'Issue Refund' }}
        </button>
      </template>
    </Modal>

    <!-- Pause Subscription Modal -->
    <Modal v-model:open="showPauseModal" :title="`Pause ${selectedEnrollment?.offerName || 'Plan'}`">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">
        Pausing will use the {{ processorLabel(selectedEnrollment?.processorType) }} subscription tied to this program and stop future billing until resumed.
      </p>
      <div class="form-group">
        <label class="form-label">Reason for pausing</label>
        <textarea class="form-textarea" v-model="pauseReason" rows="3" placeholder="e.g., Client requested temporary hold"></textarea>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showPauseModal = false">Cancel</button>
        <button class="btn btn-primary" @click="pauseEnrollment" :disabled="subLoading || !pauseReason.trim()">
          {{ subLoading ? 'Pausing...' : 'Pause Plan' }}
        </button>
      </template>
    </Modal>

    <!-- Cancel Subscription Modal -->
    <Modal v-model:open="showCancelModal" :title="`Cancel ${selectedEnrollment?.offerName || 'Plan'}`">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">
        This will permanently cancel the {{ processorLabel(selectedEnrollment?.processorType) }} subscription tied to this program and stop all future billing.
      </p>
      <div class="form-group">
        <label class="form-label">Reason for cancellation</label>
        <textarea class="form-textarea" v-model="cancelReason" rows="3" placeholder="e.g., Client completed program, financial hardship"></textarea>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="cancelConfirmed" />
          I understand this cannot be undone
        </label>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showCancelModal = false">Cancel</button>
        <button class="btn btn-danger" @click="cancelEnrollment" :disabled="subLoading || !cancelReason.trim() || !cancelConfirmed">
          {{ subLoading ? 'Cancelling...' : 'Cancel Plan' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const contactId = route.params.contactId as string;

const payments = ref<any[]>([]);
const methods = ref<any[]>([]);
const enrollments = ref<any[]>([]);
const totalCharged = ref(0);
const totalRefunded = ref(0);

// Client info
const clientLabel = ref('Payment Management');
const clientEmail = ref('');
const actionError = ref('');
const defaultMethodLabel = computed(() => {
  const method = methods.value.find((m: any) => m.isDefault) || methods.value[0];
  return method ? cardOptionLabel(method) : '';
});

// Dunning
const dunningEvent = ref<any>(null);
const dunningRetrying = ref(false);
const dunningResult = ref<any>(null);

// Card actions
const cardActionLoading = ref(false);
const cardUpdateSending = ref(false);
const cardUpdateResult = ref('');

// Subscription
const subLoading = ref(false);
const subResult = ref('');
const showPauseModal = ref(false);
const showCancelModal = ref(false);
const pauseReason = ref('');
const cancelReason = ref('');
const cancelConfirmed = ref(false);
const selectedEnrollment = ref<any | null>(null);

// Charge modal
const showChargeModal = ref(false);
const chargeLoading = ref(false);
const chargeForm = ref({ methodId: '', amount: 0, description: '' });

// Refund modal
const showRefundModal = ref(false);
const refundLoading = ref(false);
const refundForm = ref({ paymentEventId: '', amount: 0, originalAmount: 0, reason: '' });

function cardLabel(method: any) {
  if (method?.displayLabel) return method.displayLabel;
  const processor = method?.processorLabel || processorLabel(method?.processorType);
  const brand = method?.brand || 'saved payment method';
  const ending = method?.last4 ? ` ending in ${method.last4}` : '';
  return `${processor} ${brand}${ending}`.trim();
}

function cardOptionLabel(method: any) {
  return method?.displayLabel || cardLabel(method);
}

function processorLabel(proc?: string | null): string {
  const value = String(proc || '').toLowerCase();
  if (value === 'nmi') return 'NMI';
  if (value === 'stripe') return 'Stripe';
  if (value === 'ghl') return 'GHL';
  if (value === 'whop') return 'Whop';
  return proc || 'Unknown';
}

function processorBadge(proc?: string | null): string {
  const value = String(proc || '').toLowerCase();
  if (value === 'nmi') return 'badge-blue';
  if (value === 'stripe') return 'badge-gray';
  if (value === 'ghl') return 'badge-yellow';
  if (value === 'whop') return 'badge-blue';
  return 'badge-gray';
}

function paymentStatusBadge(payment: any): string {
  if (payment?.type === 'refund') return 'badge-yellow';
  if (payment?.status === 'failed') return 'badge-red';
  return 'badge-green';
}

const recurringEnrollments = computed(() => {
  return enrollments.value.filter((e: any) => isRecurringEnrollment(e) && isManageableRecurringEnrollment(e));
});

function isRecurringEnrollment(enrollment: any): boolean {
  const type = String(enrollment?.paymentType || '').toLowerCase();
  return ['installment', 'installments', 'subscription'].includes(type);
}

function isManageableRecurringEnrollment(enrollment: any): boolean {
  const status = String(enrollment?.status || '').toLowerCase();
  if (status === 'paid_pending_enrollment' || status === 'payment_processing') return false;
  if (['cancelled', 'completed'].includes(status)) return false;
  const billingStatus = String(enrollment?.billingSetupStatus || 'ok').toLowerCase();
  if (['failed', 'pending', 'needs_reconciliation'].includes(billingStatus)) return false;
  return ['enrolled', 'active', 'paused'].includes(status) || Boolean(enrollment?.processorSubscriptionId);
}

function paymentTypeLabel(type?: string | null): string {
  const value = String(type || '').toLowerCase();
  if (value === 'subscription') return 'Subscription';
  if (value === 'installment' || value === 'installments') return 'Installments';
  if (value === 'pif') return 'Paid in full';
  if (value === 'free') return 'Free';
  return type || 'Unknown';
}

function statusBadge(status?: string | null): string {
  const value = String(status || '').toLowerCase();
  if (value === 'enrolled' || value === 'active') return 'badge-green';
  if (['paused', 'consent_captured', 'pending', 'paid_pending_enrollment', 'payment_processing'].includes(value)) return 'badge-yellow';
  if (value === 'cancelled' || value === 'delinquent') return 'badge-red';
  return 'badge-gray';
}

function paymentsRemaining(enrollment: any): number | null {
  const type = String(enrollment?.paymentType || '').toLowerCase();
  if (type === 'subscription') return null;
  const total = Number(enrollment?.paymentsTotal || 0);
  if (!total) return null;
  return Math.max(0, total - Number(enrollment?.paymentsMade || 0));
}

function isWhopEnrollment(enrollment: any): boolean {
  return String(enrollment?.processorType || '').toLowerCase() === 'whop';
}

function canRequestPaymentUpdate(enrollment: any): boolean {
  return !isWhopEnrollment(enrollment);
}

function canPause(enrollment: any): boolean {
  if (isWhopEnrollment(enrollment) && !hasProcessorSubscription(enrollment)) return false;
  const status = String(enrollment?.status || '').toLowerCase();
  if (!['enrolled', 'active'].includes(status)) return false;
  const type = String(enrollment?.paymentType || '').toLowerCase();
  if (type === 'subscription') return true;
  const remaining = paymentsRemaining(enrollment);
  return remaining === null || remaining > 0 || Boolean(enrollment?.nextBillingDate);
}

function canResume(enrollment: any): boolean {
  if (isWhopEnrollment(enrollment) && !hasProcessorSubscription(enrollment)) return false;
  return String(enrollment?.status || '').toLowerCase() === 'paused';
}

function canCancel(enrollment: any): boolean {
  if (isWhopEnrollment(enrollment) && !hasProcessorSubscription(enrollment)) return false;
  const status = String(enrollment?.status || '').toLowerCase();
  return !['cancelled', 'completed'].includes(status);
}

function hasProcessorSubscription(enrollment: any): boolean {
  return Boolean(String(enrollment?.processorSubscriptionId || '').trim());
}

onMounted(async () => {
  await Promise.all([loadHistory(), loadMethods(), loadClientInfo(), loadEnrollments()]);
});

async function loadHistory() {
  try {
    const data = await api.get<any>(`/api/payments/manage/customer/${contactId}`);
    payments.value = data?.payments || [];
    totalCharged.value = data?.totalCharged || 0;
    totalRefunded.value = data?.totalRefunded || 0;

    // Check for active dunning
    const dunning = payments.value.find((p: any) => p.dunningStatus && p.dunningStatus !== 'resolved');
    dunningEvent.value = dunning ? {
      id: dunning.id,
      dunning_status: dunning.dunningStatus,
      dunning_retry_count: dunning.dunningRetryCount || 0,
      dunning_next_retry: dunning.dunningNextRetry,
    } : null;
  } catch (e: any) { actionError.value = e.message || 'Failed to load payment history'; }
}

async function loadMethods() {
  try {
    const data = await api.get<any>(`/api/payments/manage/customer/${contactId}/methods`);
    methods.value = data?.methods || [];
    if (methods.value.length > 0) {
      chargeForm.value.methodId = methods.value[0].id;
    }
  } catch (e: any) { actionError.value = e.message || 'Failed to load payment methods'; }
}

async function loadClientInfo() {
  try {
    const info = await api.get<any>(`/api/dashboard/client-info/${contactId}`);
    if (info) {
      clientLabel.value = info.name || info.email || 'Payment Management';
      clientEmail.value = info.email || '';
    }
  } catch (e: any) {
    actionError.value = e.message || 'Failed to load client info';
  }
}

async function loadEnrollments() {
  try {
    const data = await api.get<any>(`/api/dashboard/client-enrollments/${contactId}`);
    enrollments.value = data?.enrollments || [];
  } catch (e: any) {
    actionError.value = e.message || 'Failed to load recurring plans';
  }
}

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDateShort(d: string) {
  if (!d) return '-';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(d);
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Payment method management

async function sendCardUpdateRequest(enrollment: any) {
  cardUpdateSending.value = true;
  cardUpdateResult.value = '';
  actionError.value = '';
  try {
    await api.post<any>('/api/payments/lifecycle/send-card-update', {
      contactId,
      enrollmentId: enrollment.id,
      sendTrigger: true,
    });
    cardUpdateResult.value = `Payment method update request sent for ${enrollment.offerName || 'program'}.`;
    setTimeout(() => { cardUpdateResult.value = ''; }, 6000);
  } catch (e: any) { actionError.value = e.message || 'Failed to send payment method update request'; }
  cardUpdateSending.value = false;
}

async function copyCardUpdateLink(enrollment: any) {
  cardUpdateSending.value = true;
  cardUpdateResult.value = '';
  actionError.value = '';
  try {
    const result = await api.post<any>('/api/payments/lifecycle/send-card-update', {
      contactId,
      enrollmentId: enrollment.id,
      sendTrigger: false,
    });
    const link = result.link || '';
    await navigator.clipboard.writeText(link);
    cardUpdateResult.value = `Payment method update link copied for ${enrollment.offerName || 'program'}.`;
    setTimeout(() => { cardUpdateResult.value = ''; }, 3000);
  } catch (e: any) {
    actionError.value = e.message || 'Failed to create payment method update link';
  }
  cardUpdateSending.value = false;
}

async function setDefaultCard(cardId: string) {
  cardActionLoading.value = true;
  actionError.value = '';
  try {
    await api.post(`/api/payments/lifecycle/cards/${contactId}/default`, { cardId });
    await loadMethods();
  } catch (e: any) { actionError.value = e.message || 'Failed to set default payment method'; }
  cardActionLoading.value = false;
}

async function removeCard(method: any) {
  const cardId = method.id;
  const label = cardOptionLabel(method).toLowerCase();
  if (!confirm(`Remove ${label}? This cannot be undone.`)) return;
  cardActionLoading.value = true;
  actionError.value = '';
  try {
    await api.del(`/api/payments/lifecycle/cards/${contactId}/${cardId}`);
    await loadMethods();
  } catch (e: any) { actionError.value = e.message || 'Failed to remove payment method'; }
  cardActionLoading.value = false;
}

// --- Subscription Management ----------------------------

function openPause(enrollment: any) {
  selectedEnrollment.value = enrollment;
  pauseReason.value = '';
  showPauseModal.value = true;
}

function openCancel(enrollment: any) {
  selectedEnrollment.value = enrollment;
  cancelReason.value = '';
  cancelConfirmed.value = false;
  showCancelModal.value = true;
}

async function runEnrollmentAction(enrollment: any, action: 'pause' | 'resume' | 'cancel', reason?: string) {
  subLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/lifecycle/enrollment/status', {
      enrollmentId: enrollment.id,
      contactId,
      action,
      reason,
    });
    await Promise.all([loadEnrollments(), loadClientInfo(), loadHistory()]);
    const name = enrollment.offerName || 'Plan';
    const resultLabel = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'resumed';
    subResult.value = `${name} ${resultLabel}.`;
    setTimeout(() => { subResult.value = ''; }, 4000);
  } catch (e: any) {
    actionError.value = e.message || `Failed to ${action} plan`;
  }
  subLoading.value = false;
}

async function pauseEnrollment() {
  if (!selectedEnrollment.value) return;
  await runEnrollmentAction(selectedEnrollment.value, 'pause', pauseReason.value);
  showPauseModal.value = false;
  pauseReason.value = '';
  selectedEnrollment.value = null;
}

async function resumeEnrollment(enrollment: any) {
  await runEnrollmentAction(enrollment, 'resume');
}

async function cancelEnrollment() {
  if (!selectedEnrollment.value) return;
  await runEnrollmentAction(selectedEnrollment.value, 'cancel', cancelReason.value);
  showCancelModal.value = false;
  cancelReason.value = '';
  cancelConfirmed.value = false;
  selectedEnrollment.value = null;
}

// --- Dunning --------------------------------------------

async function retryDunning() {
  if (!dunningEvent.value) return;
  dunningRetrying.value = true;
  dunningResult.value = null;
  try {
    const result = await api.post<any>('/api/payments/lifecycle/dunning/retry', {
      contactId, paymentEventId: dunningEvent.value.id,
    });
    dunningResult.value = result;
    if (result.success) {
      dunningEvent.value = null;
      await loadHistory();
    }
  } catch (err: any) {
    dunningResult.value = { success: false, error: err.message || 'Retry failed' };
  }
  dunningRetrying.value = false;
}

// --- Charge & Refund ------------------------------------

function openRefund(payment: any) {
  refundForm.value = {
    paymentEventId: payment.id,
    amount: payment.amount,
    originalAmount: payment.amount,
    reason: '',
  };
  showRefundModal.value = true;
}

async function submitCharge() {
  chargeLoading.value = true;
  actionError.value = '';
  try {
    const result = await api.post<any>('/api/payments/manage/charge', {
      contactId,
      paymentMethodId: chargeForm.value.methodId,
      amount: chargeForm.value.amount,
      description: chargeForm.value.description,
    });
    if (result?.success === false) {
      throw new Error(result.error || 'Charge failed');
    }
    showChargeModal.value = false;
    chargeForm.value = { methodId: methods.value[0]?.id || '', amount: 0, description: '' };
    await loadHistory();
  } catch (e: any) { actionError.value = e.message || 'Charge failed'; }
  chargeLoading.value = false;
}

async function submitRefund() {
  refundLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/manage/refund', {
      paymentEventId: refundForm.value.paymentEventId,
      amount: refundForm.value.amount,
      reason: refundForm.value.reason,
    });
    showRefundModal.value = false;
    await loadHistory();
  } catch (e: any) { actionError.value = e.message || 'Refund failed'; }
  refundLoading.value = false;
}
</script>

<style scoped>
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.checkbox-label input {
  width: 16px;
  height: 16px;
  accent-color: var(--ss-primary-500);
}

.form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
}

.form-textarea:focus {
  border-color: #3b82f6;
  outline: none;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}

.recurring-plan {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
}

.recurring-plan:last-child {
  border-bottom: none;
}

.recurring-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.text-xs {
  font-size: 12px;
}

.control-warning {
  color: #b45309;
}
</style>
