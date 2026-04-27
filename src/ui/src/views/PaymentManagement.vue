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
    <div v-if="dunningEvent" class="card mb-4" :style="{ borderLeft: '4px solid ' + (dunningEvent.dunning_status === 'escalated' ? '#ef4444' : '#f59e0b') }">
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
            <span v-if="dunningEvent.dunning_next_retry"> · Next retry: {{ formatDate(dunningEvent.dunning_next_retry) }}</span>
          </div>
          <div v-if="dunningEvent.dunning_status === 'escalated'" class="text-sm" style="color:#ef4444;margin-top:4px;font-weight:500">
            Max retries reached — contact is delinquent. Request card update or escalate manually.
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
        <div class="flex gap-2">
          <button class="btn btn-sm btn-secondary" @click="copyCardUpdateLink" :disabled="cardUpdateSending">
            Copy Update Link
          </button>
          <button class="btn btn-sm btn-primary" @click="sendCardUpdateRequest" :disabled="cardUpdateSending">
            {{ cardUpdateSending ? 'Sending...' : 'Request Card Update' }}
          </button>
        </div>
      </div>
      <div v-if="cardUpdateResult" class="text-sm mt-2" :style="{ color: '#10b981' }">{{ cardUpdateResult }}</div>
      <div v-if="methods.length === 0" class="text-sm text-muted">No saved payment methods.</div>
      <div v-for="m in methods" :key="m.id" class="flex-between" style="padding:8px 0;border-bottom:1px solid #f3f4f6">
        <div>
          <strong>{{ m.brand || 'Card' }}</strong> ending in {{ m.last4 }}
          <span class="text-sm text-muted">(exp {{ m.expMonth }}/{{ m.expYear }})</span>
          <span v-if="m.isDefault" class="badge badge-blue" style="margin-left:6px">Default</span>
        </div>
        <div class="flex gap-2">
          <button v-if="!m.isDefault" class="btn btn-sm btn-secondary" @click="setDefaultCard(m.id)" :disabled="cardActionLoading">
            Set Default
          </button>
          <button class="btn btn-sm btn-secondary" style="color:#ef4444" @click="removeCard(m.id, m.last4)" :disabled="cardActionLoading">
            Remove
          </button>
        </div>
      </div>
    </div>

    <!-- Subscription Status (recurring plans only — installments + subscriptions) -->
    <div v-if="subscriptionStatus && isRecurring" class="card">
      <div class="flex-between">
        <div class="card-title" style="display:flex;align-items:center;gap:8px">
          Subscription
          <span class="badge" :class="subscriptionBadge">{{ subscriptionStatus }}</span>
        </div>
        <div class="flex gap-2">
          <button v-if="subscriptionStatus === 'enrolled' || subscriptionStatus === 'active'" class="btn btn-sm btn-secondary" @click="showPauseModal = true">
            Pause
          </button>
          <button v-if="subscriptionStatus === 'paused'" class="btn btn-sm btn-primary" @click="resumeSubscription" :disabled="subLoading">
            {{ subLoading ? 'Resuming...' : 'Resume' }}
          </button>
          <button v-if="subscriptionStatus !== 'cancelled'" class="btn btn-sm btn-danger" @click="showCancelModal = true">
            Cancel
          </button>
        </div>
      </div>
      <div v-if="subResult" class="text-sm" :style="{ color: '#10b981', marginTop: '8px' }">{{ subResult }}</div>
    </div>

    <!-- Quick Actions -->
    <div class="flex gap-2 mb-4">
      <button class="btn btn-primary" @click="showChargeModal = true" :disabled="methods.length === 0">
        + Charge Card
      </button>
      <span v-if="methods.length === 0" class="text-sm text-muted" style="align-self:center">No card on file — send a card update request first</span>
    </div>

    <!-- Payment History -->
    <div class="card">
      <div class="card-title">Payment History</div>
      <div v-if="payments.length === 0 && !loading" class="text-sm text-muted">No payments found.</div>
      <table v-if="payments.length > 0" class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Type</th>
            <th>Status</th>
            <th>Dunning</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id">
            <td>{{ formatDate(p.date) }}</td>
            <td>${{ p.amount.toFixed(2) }}</td>
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
            {{ m.brand }} ending in {{ m.last4 }}
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
          {{ chargeLoading ? 'Processing...' : 'Charge Card' }}
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
    <Modal v-model:open="showPauseModal" title="Pause Subscription">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">Pausing will stop future billing until resumed. This is logged as evidence.</p>
      <div class="form-group">
        <label class="form-label">Reason for pausing</label>
        <textarea class="form-textarea" v-model="pauseReason" rows="3" placeholder="e.g., Client requested temporary hold"></textarea>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showPauseModal = false">Cancel</button>
        <button class="btn btn-primary" @click="pauseSubscription" :disabled="subLoading || !pauseReason.trim()">
          {{ subLoading ? 'Pausing...' : 'Pause Subscription' }}
        </button>
      </template>
    </Modal>

    <!-- Cancel Subscription Modal -->
    <Modal v-model:open="showCancelModal" title="Cancel Subscription">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">This will permanently cancel the subscription and stop all future billing. This action is logged as evidence for chargeback defense.</p>
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
        <button class="btn btn-danger" @click="cancelSubscription" :disabled="subLoading || !cancelReason.trim() || !cancelConfirmed">
          {{ subLoading ? 'Cancelling...' : 'Cancel Subscription' }}
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
const totalCharged = ref(0);
const totalRefunded = ref(0);

// Client info
const clientLabel = ref('Payment Management');
const clientEmail = ref('');
const subscriptionStatus = ref('');
const paymentType = ref('');
const isRecurring = computed(() => paymentType.value === 'installment' || paymentType.value === 'installments' || paymentType.value === 'subscription');
const actionError = ref('');

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

// Charge modal
const showChargeModal = ref(false);
const chargeLoading = ref(false);
const chargeForm = ref({ methodId: '', amount: 0, description: '' });

// Refund modal
const showRefundModal = ref(false);
const refundLoading = ref(false);
const refundForm = ref({ paymentEventId: '', amount: 0, originalAmount: 0, reason: '' });

const subscriptionBadge = computed(() => {
  const s = subscriptionStatus.value;
  if (s === 'enrolled' || s === 'active') return 'badge-green';
  if (s === 'paused') return 'badge-yellow';
  if (s === 'cancelled' || s === 'delinquent') return 'badge-red';
  return 'badge-gray';
});

onMounted(async () => {
  await Promise.all([loadHistory(), loadMethods(), loadClientInfo()]);
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
      subscriptionStatus.value = info.status || '';
      paymentType.value = info.paymentType || '';
    }
  } catch (e: any) {
    actionError.value = e.message || 'Failed to load client info';
  }
}

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─── Card Management ────────────────────────────────────

async function sendCardUpdateRequest() {
  cardUpdateSending.value = true;
  cardUpdateResult.value = '';
  actionError.value = '';
  try {
    const result = await api.post<any>('/api/payments/lifecycle/send-card-update', { contactId });
    cardUpdateResult.value = 'Card update request sent! Link: ' + (result.link || '').split('?')[0] + '...';
    setTimeout(() => { cardUpdateResult.value = ''; }, 6000);
  } catch (e: any) { actionError.value = e.message || 'Failed to send card update request'; }
  cardUpdateSending.value = false;
}

async function copyCardUpdateLink() {
  const link = `${window.location.origin}/payment-update?contactId=${encodeURIComponent(contactId)}&locationId=${encodeURIComponent(sessionStorage.getItem('ss_location_id') || '')}`;
  try {
    await navigator.clipboard.writeText(link);
    cardUpdateResult.value = 'Link copied to clipboard!';
    setTimeout(() => { cardUpdateResult.value = ''; }, 3000);
  } catch {
    cardUpdateResult.value = link; // Fallback: show the link
  }
}

async function setDefaultCard(cardId: string) {
  cardActionLoading.value = true;
  actionError.value = '';
  try {
    await api.post(`/api/payments/lifecycle/cards/${contactId}/default`, { cardId });
    await loadMethods();
  } catch (e: any) { actionError.value = e.message || 'Failed to set default card'; }
  cardActionLoading.value = false;
}

async function removeCard(cardId: string, last4: string) {
  if (!confirm(`Remove card ending in ${last4}? This cannot be undone.`)) return;
  cardActionLoading.value = true;
  actionError.value = '';
  try {
    await api.del(`/api/payments/lifecycle/cards/${contactId}/${cardId}`);
    await loadMethods();
  } catch (e: any) { actionError.value = e.message || 'Failed to remove card'; }
  cardActionLoading.value = false;
}

// ─── Subscription Management ────────────────────────────

async function pauseSubscription() {
  subLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/lifecycle/subscription/pause', {
      contactId, reason: pauseReason.value,
    });
    showPauseModal.value = false;
    pauseReason.value = '';
    subResult.value = 'Subscription paused.';
    subscriptionStatus.value = 'paused';
    setTimeout(() => { subResult.value = ''; }, 4000);
  } catch (e: any) { actionError.value = e.message || 'Failed to pause subscription'; }
  subLoading.value = false;
}

async function resumeSubscription() {
  subLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/lifecycle/subscription/resume', { contactId });
    subResult.value = 'Subscription resumed.';
    subscriptionStatus.value = 'enrolled';
    setTimeout(() => { subResult.value = ''; }, 4000);
  } catch (e: any) { actionError.value = e.message || 'Failed to resume subscription'; }
  subLoading.value = false;
}

async function cancelSubscription() {
  subLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/lifecycle/subscription/cancel', {
      contactId, reason: cancelReason.value,
    });
    showCancelModal.value = false;
    cancelReason.value = '';
    cancelConfirmed.value = false;
    subResult.value = 'Subscription cancelled.';
    subscriptionStatus.value = 'cancelled';
    setTimeout(() => { subResult.value = ''; }, 4000);
  } catch (e: any) { actionError.value = e.message || 'Failed to cancel subscription'; }
  subLoading.value = false;
}

// ─── Dunning ────────────────────────────────────────────

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

// ─── Charge & Refund ────────────────────────────────────

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
    await api.post('/api/payments/manage/charge', {
      contactId,
      paymentMethodId: chargeForm.value.methodId,
      amount: chargeForm.value.amount,
      description: chargeForm.value.description,
    });
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
</style>
