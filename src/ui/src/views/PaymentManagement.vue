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

    <!-- Saved Payment Methods -->
    <div class="card">
      <div class="card-title">Saved Payment Methods</div>
      <div v-if="methods.length === 0" class="text-sm text-muted">No saved payment methods.</div>
      <div v-for="m in methods" :key="m.id" class="flex-between" style="padding:8px 0;border-bottom:1px solid #f3f4f6">
        <div>
          <strong>{{ m.brand || 'Card' }}</strong> ending in {{ m.last4 }}
          <span class="text-sm text-muted">(exp {{ m.expMonth }}/{{ m.expYear }})</span>
          <span v-if="m.isDefault" class="badge badge-blue" style="margin-left:6px">Default</span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="flex gap-2 mb-4">
      <button class="btn btn-primary" @click="showChargeModal = true" :disabled="methods.length === 0">
        + Charge Card
      </button>
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
    <div v-if="showChargeModal" class="modal-overlay" @click.self="showChargeModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:16px">One-Time Charge</h3>
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
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showChargeModal = false">Cancel</button>
          <button class="btn btn-primary" @click="submitCharge" :disabled="chargeLoading">
            {{ chargeLoading ? 'Processing...' : 'Charge Card' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Refund Modal -->
    <div v-if="showRefundModal" class="modal-overlay" @click.self="showRefundModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:16px">Issue Refund</h3>
        <p class="text-sm text-muted mb-4">Original charge: ${{ refundForm.originalAmount.toFixed(2) }}</p>
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
        <p class="text-sm text-muted mb-4">Refunds may take 5-10 business days to process.</p>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showRefundModal = false">Cancel</button>
          <button class="btn btn-danger" @click="submitRefund" :disabled="refundLoading">
            {{ refundLoading ? 'Processing...' : 'Issue Refund' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const contactId = route.params.contactId as string;

const payments = ref<any[]>([]);
const methods = ref<any[]>([]);
const totalCharged = ref(0);
const totalRefunded = ref(0);

// Charge modal
const showChargeModal = ref(false);
const chargeLoading = ref(false);
const chargeForm = ref({ methodId: '', amount: 0, description: '' });

// Refund modal
const showRefundModal = ref(false);
const refundLoading = ref(false);
const refundForm = ref({ paymentEventId: '', amount: 0, originalAmount: 0, reason: '' });
const clientLabel = ref('Payment Management');
const clientEmail = ref('');

onMounted(async () => {
  await Promise.all([loadHistory(), loadMethods()]);
  // Load client name/email
  try {
    const info = await api.get<any>(`/api/dashboard/client-info/${contactId}`);
    if (info) {
      clientLabel.value = info.name || info.email || 'Payment Management';
      clientEmail.value = info.email || '';
    }
  } catch {}
});

async function loadHistory() {
  try {
    const data = await api.get<any>(`/api/payments/manage/customer/${contactId}`);
    payments.value = data?.payments || [];
    totalCharged.value = data?.totalCharged || 0;
    totalRefunded.value = data?.totalRefunded || 0;
  } catch {}
}

async function loadMethods() {
  try {
    const data = await api.get<any>(`/api/payments/manage/customer/${contactId}/methods`);
    methods.value = data?.methods || [];
    if (methods.value.length > 0) {
      chargeForm.value.methodId = methods.value[0].id;
    }
  } catch {}
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  } catch {}
  chargeLoading.value = false;
}

async function submitRefund() {
  refundLoading.value = true;
  try {
    await api.post('/api/payments/manage/refund', {
      paymentEventId: refundForm.value.paymentEventId,
      amount: refundForm.value.amount,
      reason: refundForm.value.reason,
    });
    showRefundModal.value = false;
    await loadHistory();
  } catch {}
  refundLoading.value = false;
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 420px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

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
  accent-color: #3b82f6;
}
</style>
