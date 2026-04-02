<template>
  <div>
    <h1 class="page-title">{{ isEdit ? 'Edit Offer' : 'New Offer' }}</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Onboarding gate -->
    <div v-if="!merchantConfigLoading && !onboardingComplete" class="onboarding-gate">
      <h3>Setup Required</h3>
      <p>Complete your business setup in <router-link to="/settings">Settings</router-link> before creating offers.</p>
    </div>

    <form v-else-if="!merchantConfigLoading" @submit.prevent="save" class="card" style="max-width: 720px">
      <!-- Program Info -->
      <div class="form-group">
        <label class="form-label">Program Name *</label>
        <input class="form-input" v-model="form.offerName" required />
      </div>

      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" v-model="form.programDescription"></textarea>
      </div>

      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Delivery Method</label>
          <select class="form-select" v-model="form.deliveryMethod">
            <option value="">Select...</option>
            <option value="Done With You">Done With You</option>
            <option value="Done For You">Done For You</option>
            <option value="Live Virtual (Zoom/Meet)">Live Virtual</option>
            <option value="In-Person">In-Person</option>
            <option value="Self-Paced / On-Demand">Self-Paced</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Digital Download">Digital Download</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Program Duration</label>
          <div class="flex gap-2">
            <input class="form-input" type="number" min="1" v-model.number="form.programDurationValue"
              placeholder="e.g., 12" style="flex:1" />
            <select class="form-select" v-model="form.programDurationUnit" style="flex:1">
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Pricing -->
      <h3 class="mt-4 mb-4">Pricing</h3>

      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Total Price *</label>
          <input class="form-input" type="number" step="0.01" v-model.number="form.price" required />
        </div>
        <div class="form-group">
          <label class="form-label">Payment Type</label>
          <select class="form-select" v-model="form.paymentType">
            <option value="one_time">Pay in Full</option>
            <option value="installments">Installments</option>
          </select>
        </div>
      </div>

      <div v-if="form.paymentType === 'installments'">
        <div class="grid grid-3">
          <div class="form-group">
            <label class="form-label"># of Payments *</label>
            <input class="form-input" type="number" min="1" v-model.number="form.numPayments" />
          </div>
          <div class="form-group">
            <label class="form-label">Installment Amount</label>
            <input class="form-input" type="number" step="0.01" :value="calculatedInstallment" readonly
              class="readonly-field" />
            <p class="text-sm text-muted mt-2" v-if="calculatedInstallment">
              Auto-calculated: ${{ form.price }} / {{ form.numPayments }} payments
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Frequency</label>
            <select class="form-select" v-model="form.installmentFrequency">
              <option value="weekly">Weekly</option>
              <option value="bi_weekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.pifDiscountEnabled" />
            Offer a pay-in-full discount
          </label>
        </div>
        <div v-if="form.pifDiscountEnabled" class="form-group">
          <label class="form-label">Pay-in-Full Discount Price</label>
          <input class="form-input" type="number" step="0.01" v-model.number="form.pifPrice"
            :placeholder="`e.g., ${Math.round((form.price || 0) * 0.9)}`"
            style="max-width: 250px" />
          <p class="text-sm text-muted mt-2" v-if="form.price && form.pifPrice">
            Saves client ${{ (form.price - form.pifPrice).toFixed(2) }}
            ({{ Math.round((1 - form.pifPrice / form.price) * 100) }}% off)
          </p>
        </div>
      </div>

      <!-- Refund Policy -->
      <h3 class="mt-4 mb-4">Refund Policy</h3>
      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Refund Policy</label>
          <select class="form-select" v-model="form.refundPolicyType">
            <option value="">Select...</option>
            <option value="no_refunds">No Refunds</option>
            <option value="full_refund">Full Refund Within X Days</option>
            <option value="prorated">Prorated Refund</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div v-if="form.refundPolicyType === 'full_refund'" class="form-group">
          <label class="form-label">Refund Window (Days)</label>
          <input class="form-input" type="number" min="1" v-model.number="form.refundPolicyDays" placeholder="e.g., 30" />
        </div>
      </div>
      <div v-if="form.refundPolicyType === 'custom'" class="form-group">
        <label class="form-label">Custom Refund Policy</label>
        <textarea class="form-textarea" v-model="form.refundWindowText" placeholder="Describe your refund policy..."></textarea>
      </div>

      <!-- Terms & Conditions -->
      <h3 class="mt-4 mb-4">Terms & Conditions</h3>

      <div v-if="merchantConfig?.tcHasOwn" class="text-sm text-muted mb-4">
        Your merchant account uses a custom T&C document: <a :href="merchantConfig.tcDocumentUrl" target="_blank">{{ merchantConfig.tcDocumentUrl }}</a>
      </div>

      <div v-else>
        <p class="text-sm text-muted mb-4">
          Standard clauses from your merchant config are shown below. Toggle additional clauses on or off for this specific offer.
        </p>

        <div v-for="clause in standardClauses" :key="clause.key" class="clause-toggle mb-4">
          <label class="checkbox-label">
            <input type="checkbox" :checked="isClauseEnabled(clause.key)" @change="toggleClause(clause.key)" />
            <span>
              {{ clause.label }}
              <span v-if="clause.recommended" class="badge badge-blue" style="font-size:10px;margin-left:4px">Recommended</span>
              <span v-if="isMerchantDefault(clause.key)" class="badge badge-green" style="font-size:10px;margin-left:4px">Merchant Default</span>
            </span>
          </label>
          <p class="text-sm text-muted" style="margin-left:24px;margin-top:4px">{{ clause.text }}</p>
        </div>

        <h4 class="mt-4 mb-4" style="font-size:14px;font-weight:600">Custom Clauses</h4>
        <p class="text-sm text-muted mb-4">
          Override or add to your merchant-level custom clauses for this offer.
        </p>
        <div class="clause-row mb-4">
          <div class="form-group">
            <label class="form-label">Custom Clause 1 Title</label>
            <input class="form-input" v-model="form.customClause1Title"
              :placeholder="merchantConfig?.customClause1Title || 'Custom clause title'" />
          </div>
          <div class="form-group">
            <label class="form-label">Custom Clause 1 Text</label>
            <textarea class="form-textarea" v-model="form.customClause1Text" style="min-height:50px"
              :placeholder="merchantConfig?.customClause1Text || 'Clause text...'"></textarea>
          </div>
        </div>
        <div class="clause-row">
          <div class="form-group">
            <label class="form-label">Custom Clause 2 Title</label>
            <input class="form-input" v-model="form.customClause2Title"
              :placeholder="merchantConfig?.customClause2Title || 'Custom clause title'" />
          </div>
          <div class="form-group">
            <label class="form-label">Custom Clause 2 Text</label>
            <textarea class="form-textarea" v-model="form.customClause2Text" style="min-height:50px"
              :placeholder="merchantConfig?.customClause2Text || 'Clause text...'"></textarea>
          </div>
        </div>
      </div>

      <!-- Milestones -->
      <h3 class="mt-4 mb-4">Milestones</h3>
      <p class="text-sm text-muted mb-4">
        Define up to 8 program milestones. Only fill in the milestones that apply.
      </p>
      <div v-for="(m, i) in form.milestones" :key="i" class="grid grid-3 mb-4" style="align-items:end">
        <div class="form-group">
          <label class="form-label">Milestone {{ i + 1 }} Name</label>
          <input class="form-input" v-model="m.name" :placeholder="`Milestone ${i + 1}`" />
        </div>
        <div class="form-group">
          <label class="form-label">We Deliver</label>
          <input class="form-input" v-model="m.delivers" />
        </div>
        <div class="form-group">
          <label class="form-label">Client Responsibility</label>
          <input class="form-input" v-model="m.clientDoes" />
        </div>
      </div>

      <div class="flex gap-2 mt-4">
        <button type="submit" class="btn btn-primary" :disabled="loading">
          {{ loading ? 'Saving...' : (isEdit ? 'Update Offer' : 'Create Offer') }}
        </button>
        <router-link to="/offers" class="btn btn-secondary">Cancel</router-link>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';

const route = useRoute();
const routerNav = useRouter();
const api = useApi();
const { loading, error } = api;

const isEdit = computed(() => !!route.params.id);

const merchantConfig = ref<any>(null);
const merchantConfigLoading = ref(true);
const onboardingComplete = ref(false);

const standardClauses = [
  { key: 'purchase_summary', label: 'Purchase Summary', text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.', recommended: true },
  { key: 'cardholder_auth', label: 'Cardholder Authorization', text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.', recommended: true },
  { key: 'program_scope', label: 'Program Scope', text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.', recommended: false },
  { key: 'refund_cancellation', label: 'Refund & Cancellation', text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.', recommended: false },
  { key: 'digital_access', label: 'Digital Access', text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.', recommended: false },
  { key: 'participation_responsibility', label: 'Participation Responsibility', text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.', recommended: false },
  { key: 'no_guaranteed_results', label: 'No Guaranteed Results', text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.', recommended: false },
  { key: 'installment_billing', label: 'Installment Billing', text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.', recommended: false },
  { key: 'feedback_checkin', label: 'Feedback & Check-In', text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.', recommended: false },
];

const form = ref({
  offerName: '',
  programDescription: '',
  deliveryMethod: '',
  price: 0,
  paymentType: 'one_time' as 'one_time' | 'installments',
  installmentFrequency: 'monthly',
  numPayments: 0,
  pifPrice: 0,
  pifDiscountEnabled: false,
  programDurationValue: null as number | null,
  programDurationUnit: 'weeks' as 'weeks' | 'months',
  refundPolicyType: '' as string,
  refundPolicyDays: 30,
  refundWindowText: '',
  tcClauseOverrides: {} as Record<string, boolean>,
  customClause1Title: '',
  customClause1Text: '',
  customClause2Title: '',
  customClause2Text: '',
  milestones: Array.from({ length: 8 }, () => ({ name: '', delivers: '', clientDoes: '' })),
});

const calculatedInstallment = computed(() => {
  if (form.value.price && form.value.numPayments && form.value.numPayments > 0) {
    return (Math.round((form.value.price / form.value.numPayments) * 100) / 100).toFixed(2);
  }
  return '';
});

function isMerchantDefault(key: string): boolean {
  return merchantConfig.value?.standardClauses?.[key] === true;
}

function isClauseEnabled(key: string): boolean {
  if (form.value.tcClauseOverrides[key] !== undefined) {
    return form.value.tcClauseOverrides[key];
  }
  return merchantConfig.value?.standardClauses?.[key] === true;
}

function toggleClause(key: string) {
  const current = isClauseEnabled(key);
  form.value.tcClauseOverrides[key] = !current;
}

onMounted(async () => {
  // Load merchant config first (for onboarding gate + T&C defaults)
  try {
    merchantConfig.value = await api.get<any>('/api/merchants/config');
    onboardingComplete.value = merchantConfig.value?.onboardingComplete === true;
  } catch {
    onboardingComplete.value = false;
  }
  merchantConfigLoading.value = false;

  // Load existing offer for edit mode
  if (isEdit.value) {
    try {
      const offer = await api.get<any>(`/api/offers/${route.params.id}`);
      form.value.offerName = offer.offer_name || '';
      form.value.programDescription = offer.program_description || '';
      form.value.deliveryMethod = offer.delivery_method || '';
      form.value.price = offer.price || 0;
      form.value.paymentType = offer.payment_type || 'one_time';
      form.value.installmentFrequency = offer.installment_frequency || 'monthly';
      form.value.numPayments = offer.num_payments || 0;
      form.value.pifPrice = offer.pif_price || 0;
      form.value.pifDiscountEnabled = offer.pif_discount_enabled || false;
      form.value.programDurationValue = offer.program_duration_value || null;
      form.value.programDurationUnit = offer.program_duration_unit || 'weeks';
      form.value.refundPolicyType = offer.refund_policy_type || '';
      form.value.refundPolicyDays = offer.refund_policy_days || 30;
      form.value.refundWindowText = offer.refund_window_text || '';
      form.value.tcClauseOverrides = offer.tc_clause_overrides || {};
      form.value.customClause1Title = offer.clause_slot_10_title || '';
      form.value.customClause1Text = offer.clause_slot_10_text || '';
      form.value.customClause2Title = offer.clause_slot_11_title || '';
      form.value.customClause2Text = offer.clause_slot_11_text || '';

      for (let i = 0; i < 8; i++) {
        form.value.milestones[i].name = offer[`m${i + 1}_name`] || '';
        form.value.milestones[i].delivers = offer[`m${i + 1}_delivers`] || '';
        form.value.milestones[i].clientDoes = offer[`m${i + 1}_client_does`] || '';
      }
    } catch {}
  }
});

async function save() {
  const mc = merchantConfig.value || {};

  const payload: any = {
    ...form.value,
    installmentAmount: calculatedInstallment.value ? parseFloat(calculatedInstallment.value) : 0,
    milestones: form.value.milestones.filter(m => m.name),
    // Pass merchant T&C context for server-side compilation
    merchantTcClauseToggles: mc.standardClauses || {},
    merchantCustomClause1Title: mc.customClause1Title || '',
    merchantCustomClause1Text: mc.customClause1Text || '',
    merchantCustomClause2Title: mc.customClause2Title || '',
    merchantCustomClause2Text: mc.customClause2Text || '',
    merchantTcHasOwn: mc.tcHasOwn || false,
    merchantTcDocumentUrl: mc.tcDocumentUrl || '',
  };

  if (!payload.pifDiscountEnabled) {
    payload.pifPrice = 0;
  }

  try {
    if (isEdit.value) {
      await api.put(`/api/offers/${route.params.id}`, payload);
    } else {
      await api.post('/api/offers', payload);
    }
    routerNav.push('/offers');
  } catch {}
}
</script>

<style scoped>
.onboarding-gate {
  background: #fef3c7;
  color: #92400e;
  padding: 24px;
  border-radius: 8px;
  border-left: 4px solid #f59e0b;
  max-width: 600px;
}

.onboarding-gate a {
  color: #b45309;
  font-weight: 600;
}

.checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  color: #374151;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: #3b82f6;
  flex-shrink: 0;
}

.clause-toggle {
  border-left: 3px solid #e5e7eb;
  padding-left: 16px;
}

.clause-row {
  border-left: 3px solid #dbeafe;
  padding-left: 16px;
}

.readonly-field {
  background: #f3f4f6;
  color: #6b7280;
  cursor: not-allowed;
}
</style>
