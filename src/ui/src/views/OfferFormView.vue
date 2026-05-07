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
            <option value="subscription">Subscription (Ongoing)</option>
          </select>
        </div>
      </div>

      <!-- Subscription fields -->
      <div v-if="form.paymentType === 'subscription'">
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Amount Per Period *</label>
            <input class="form-input" type="number" step="0.01" min="0.01" v-model.number="form.installmentAmount" placeholder="e.g., 99.00" />
            <p class="text-sm text-muted mt-2">Recurring charge amount each billing period</p>
          </div>
          <div class="form-group">
            <label class="form-label">Billing Frequency</label>
            <select class="form-select" v-model="form.installmentFrequency">
              <option v-if="enableDailyTestBilling" value="daily">Daily (Testing)</option>
              <option value="weekly">Weekly</option>
              <option value="bi_weekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Installment fields -->
      <div v-if="form.paymentType === 'installments'">
        <div class="grid grid-3">
          <div class="form-group">
            <label class="form-label"># of Payments *</label>
            <input class="form-input" type="number" min="1" v-model.number="form.numPayments" />
          </div>
          <div class="form-group">
            <label class="form-label">Installment Amount</label>
            <input class="form-input readonly-field" type="text" :value="calculatedInstallment ? '$' + calculatedInstallment : '—'" readonly />
            <p class="text-sm text-muted mt-2" v-if="calculatedInstallment">
              Auto-calculated: ${{ form.price }} / {{ form.numPayments }} payments
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Frequency</label>
            <select class="form-select" v-model="form.installmentFrequency">
              <option v-if="enableDailyTestBilling" value="daily">Daily (Testing)</option>
              <option value="weekly">Weekly</option>
              <option value="bi_weekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
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

      <!-- Checkout Experience (Phase J) -->
      <h3 class="mt-4 mb-4">Checkout Experience</h3>
      <p class="text-sm text-muted mb-4">How should clients purchase this offer?</p>

      <div class="checkout-mode-group mb-4">
        <label class="radio-card" :class="{ active: form.checkoutMode === 'full_enrollment' }">
          <input type="radio" v-model="form.checkoutMode" value="full_enrollment" />
          <div>
            <strong>Full Enrollment</strong>
            <span class="badge badge-blue" style="font-size:10px;margin-left:6px">Recommended for $1K+</span>
            <p class="text-sm text-muted" style="margin-top:4px">4-page funnel with complete evidence capture: client info, offer review, detailed consent, then payment.</p>
          </div>
        </label>
        <label class="radio-card" :class="{ active: form.checkoutMode === 'quick_checkout' }">
          <input type="radio" v-model="form.checkoutMode" value="quick_checkout" />
          <div>
            <strong>Quick Checkout</strong>
            <span class="badge badge-gray" style="font-size:10px;margin-left:6px">For lower-ticket items</span>
            <p class="text-sm text-muted" style="margin-top:4px">Streamlined payment page with inline consent. Faster but captures less evidence for dispute defense.</p>
          </div>
        </label>
      </div>

      <div v-if="form.checkoutMode === 'quick_checkout'" class="quick-checkout-options mb-4">
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.quickCheckoutShowDescription" />
            Show program description on checkout page
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.quickCheckoutShowRefundPolicy" />
            Show refund policy on checkout page
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Consent Text</label>
          <textarea class="form-textarea" v-model="form.quickCheckoutConsentText"
            placeholder="I agree to the terms and conditions and authorize this charge."
            style="min-height:60px"></textarea>
          <p class="text-sm text-muted mt-2">This text appears next to a checkbox the client must check before paying.</p>
        </div>
      </div>

      <!-- Pulse Cadence -->
      <h3 class="mt-4 mb-4">Pulse Check-Ins</h3>
      <div class="grid grid-2">
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.pulseCadenceEnabled" />
            Send scheduled pulse check-ins for this offer
          </label>
          <p class="text-sm text-muted mt-2">Check in with clients automatically during active enrollments.</p>
        </div>
        <div v-if="form.pulseCadenceEnabled" class="form-group">
          <label class="form-label">Cadence</label>
          <select class="form-select" v-model.number="form.pulseFrequencyDays">
            <option :value="7">Weekly</option>
            <option :value="14">Every 2 weeks</option>
            <option :value="30">Monthly</option>
            <option :value="60">Every 60 days</option>
            <option :value="90">Quarterly</option>
          </select>
        </div>
      </div>

      <!-- Terms & Conditions -->
      <h3 class="mt-4 mb-4">Terms & Conditions</h3>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="form.tcHasOwn" />
          I have my own Terms & Conditions document
        </label>
      </div>

      <div v-if="form.tcHasOwn" class="form-group">
        <label class="form-label">T&C Document URL</label>
        <input class="form-input" type="url" v-model="form.tcUrl" placeholder="https://yourdomain.com/terms" />
      </div>

      <div>
        <p class="text-sm text-muted mb-4">
          Toggle the clickwrap acknowledgments clients must agree to during enrollment.
          These are shown in addition to any linked terms document. Clauses marked "Recommended" are suggested for chargeback protection.
        </p>

        <div v-for="(clause, idx) in standardClauses" :key="clause.key" class="clause-toggle mb-4">
          <label class="checkbox-label">
            <input type="checkbox" v-model="form.clauseToggles[idx]" />
            <span>
              {{ clause.label }}
              <span v-if="clause.recommended" class="badge badge-blue" style="font-size:10px;margin-left:4px">Recommended</span>
            </span>
          </label>
          <p class="text-sm text-muted" style="margin-left:24px;margin-top:4px">{{ clause.text }}</p>
        </div>

        <h4 class="mt-4 mb-4" style="font-size:14px;font-weight:600">Custom Clauses</h4>
        <p class="text-sm text-muted mb-4">
          Add up to 2 custom clauses with your own title and text.
        </p>
        <div class="clause-row mb-4">
          <div class="form-group">
            <label class="form-label">Custom Clause 1 Title</label>
            <input class="form-input" v-model="form.customClause1Title" placeholder="e.g., Non-Disclosure Agreement" />
          </div>
          <div class="form-group">
            <label class="form-label">Custom Clause 1 Text</label>
            <textarea class="form-textarea" v-model="form.customClause1Text" style="min-height:50px"
              placeholder="Clause text..."></textarea>
          </div>
        </div>
        <div class="clause-row">
          <div class="form-group">
            <label class="form-label">Custom Clause 2 Title</label>
            <input class="form-input" v-model="form.customClause2Title" placeholder="e.g., Intellectual Property" />
          </div>
          <div class="form-group">
            <label class="form-label">Custom Clause 2 Text</label>
            <textarea class="form-textarea" v-model="form.customClause2Text" style="min-height:50px"
              placeholder="Clause text..."></textarea>
          </div>
        </div>
      </div>

      <!-- Payment Processor Override -->
      <h3 class="mt-4 mb-4">Payment Processor</h3>
      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Payment Processor</label>
          <select class="form-select" v-model="form.processorOverride">
            <option value="">Use Default{{ defaultProcessorLabel ? ' (' + defaultProcessorLabel + ')' : '' }}</option>
            <option value="nmi">NMI</option>
            <option value="stripe" :disabled="!stripeConnected">Stripe{{ !stripeConnected ? ' (not connected)' : '' }}</option>
          </select>
        </div>
        <div
          v-if="(form.processorOverride === 'nmi' || (!form.processorOverride && defaultProcessor === 'nmi')) && nmiProcessorIds.length > 1"
          class="form-group"
        >
          <label class="form-label">NMI Merchant Account</label>
          <select class="form-select" v-model="form.nmiProcessorId">
            <option value="">Default</option>
            <option v-for="pid in nmiProcessorIds" :key="pid.id" :value="pid.id">
              {{ pid.label || pid.id }}
            </option>
          </select>
        </div>
      </div>

      <!-- Milestones (progressive disclosure: show filled rows + one blank, up to 8) -->
      <h3 class="mt-4 mb-4">Milestones</h3>
      <p class="text-sm text-muted mb-4">
        Define up to 8 program milestones. Add one at a time — only the rows you fill in are saved.
      </p>
      <div v-for="i in visibleMilestoneCount" :key="i - 1" class="grid grid-3 mb-4" style="align-items:end">
        <div class="form-group">
          <label class="form-label">Milestone {{ i }} Name</label>
          <input class="form-input" v-model="form.milestones[i - 1].name" :placeholder="`Milestone ${i}`" />
        </div>
        <div class="form-group">
          <label class="form-label">We Deliver</label>
          <input class="form-input" v-model="form.milestones[i - 1].delivers" />
        </div>
        <div class="form-group">
          <label class="form-label">Client Responsibility</label>
          <input class="form-input" v-model="form.milestones[i - 1].clientDoes" />
        </div>
      </div>
      <button
        v-if="visibleMilestoneCount < 8 && form.milestones[visibleMilestoneCount - 1]?.name"
        type="button"
        class="btn btn-sm btn-secondary mb-4"
        @click="addMilestone"
      >
        + Add milestone
      </button>

      <!-- Save / Cancel handled by sticky save bar below — no inline buttons. -->
    </form>

    <StickySaveBar
      v-if="!merchantConfigLoading && onboardingComplete"
      :dirty="true"
      :loading="loading"
      :save-label="isEdit ? 'Update Offer' : 'Create Offer'"
      cancel-label="Cancel"
      @save="save"
      @cancel="routerNav.push('/offers')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi, ssoSession } from '../composables/useApi';
import StickySaveBar from '../components/StickySaveBar.vue';

const route = useRoute();
const routerNav = useRouter();
const api = useApi();
const { loading, error } = api;

const isEdit = computed(() => !!route.params.id);

const merchantConfigLoading = ref(true);
const onboardingComplete = ref(false);
const enableDailyTestBilling = import.meta.env.VITE_ENABLE_DAILY_TEST_BILLING === 'true';

// Processor override state
const defaultProcessor = ref('');
const defaultProcessorLabel = computed(() => {
  const map: Record<string, string> = { nmi: 'NMI', stripe: 'Stripe' };
  return map[defaultProcessor.value] || '';
});
const stripeConnected = ref(false);
const nmiProcessorIds = ref<Array<{ id: string; label: string }>>([]);

const standardClauses = [
  { key: 'purchase_summary', label: 'Purchase Summary', text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.', recommended: true },
  { key: 'cardholder_auth', label: 'Cardholder Authorization', text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.', recommended: true },
  { key: 'program_scope', label: 'Program Scope', text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.', recommended: false },
  { key: 'refund_cancellation', label: 'Refund & Cancellation', text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.', recommended: false },
  { key: 'digital_access', label: 'Digital Access', text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.', recommended: false },
  { key: 'participation_responsibility', label: 'Participation Responsibility', text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.', recommended: false },
  { key: 'no_guaranteed_results', label: 'No Guaranteed Results', text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.', recommended: false },
  { key: 'installment_billing', label: 'Installment Billing', text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.', recommended: false },
  { key: 'feedback_checkin', label: 'Feedback & Check-In', text: 'I understand that periodic check-ins, surveys, or progress reviews may be requested during the program to monitor my satisfaction and progress. I agree to respond to these check-ins in good faith and understand that the merchant may reference my responses as part of the program record.', recommended: false },
];

const form = ref({
  offerName: '',
  programDescription: '',
  deliveryMethod: '',
  price: 0,
  paymentType: 'one_time' as 'one_time' | 'installments' | 'subscription',
  installmentAmount: 0,
  installmentFrequency: 'monthly',
  numPayments: 0,
  pifPrice: 0,
  pifDiscountEnabled: false,
  programDurationValue: null as number | null,
  programDurationUnit: 'weeks' as 'weeks' | 'months',
  refundPolicyType: '' as string,
  refundPolicyDays: 30,
  refundWindowText: '',
  tcHasOwn: false,
  tcUrl: '',
  // Boolean array for 9 standard clauses (index matches standardClauses array)
  clauseToggles: [true, true, false, false, false, false, false, false, false] as boolean[],
  customClause1Title: '',
  customClause1Text: '',
  customClause2Title: '',
  customClause2Text: '',
  milestones: Array.from({ length: 8 }, () => ({ name: '', delivers: '', clientDoes: '' })),
  processorOverride: '' as string,
  nmiProcessorId: '' as string,
  checkoutMode: 'full_enrollment' as string,
  quickCheckoutConsentText: '',
  quickCheckoutShowDescription: true,
  quickCheckoutShowRefundPolicy: true,
  pulseCadenceEnabled: true,
  pulseFrequencyDays: 30,
});

const visibleMilestoneCount = ref(1);

function addMilestone() {
  if (visibleMilestoneCount.value < 8) visibleMilestoneCount.value += 1;
}

const calculatedInstallment = computed(() => {
  if (form.value.price && form.value.numPayments && form.value.numPayments > 0) {
    return (Math.round((form.value.price / form.value.numPayments) * 100) / 100).toFixed(2);
  }
  return '';
});

onMounted(async () => {
  // Check onboarding status and load processor config
  try {
    const mc = await api.get<any>('/api/merchants/config');
    onboardingComplete.value = mc?.onboardingComplete === true;
  } catch {
    onboardingComplete.value = false;
  }

  // Load processor config from merchant config (optional)
  try {
    const pc = await api.get<any>('/api/merchants/config');
    defaultProcessor.value = pc.defaultProcessor || '';
    stripeConnected.value = pc.stripeConnected || false;
  } catch {
    // Processor config may not exist yet
  }

  // Clear any 404 errors from optional config fetches above
  error.value = null;
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
      form.value.installmentAmount = offer.installment_amount || 0;
      form.value.installmentFrequency = offer.installment_frequency || 'monthly';
      form.value.numPayments = offer.num_payments || 0;
      form.value.pifPrice = offer.pif_price || 0;
      form.value.pifDiscountEnabled = offer.pif_discount_enabled || false;
      form.value.programDurationValue = offer.program_duration_value || null;
      form.value.programDurationUnit = offer.program_duration_unit || 'weeks';
      form.value.refundPolicyType = offer.refund_policy_type || '';
      form.value.refundPolicyDays = offer.refund_policy_days || 30;
      form.value.refundWindowText = offer.refund_window_text || '';
      form.value.tcHasOwn = !!(offer.tc_url);
      form.value.tcUrl = offer.tc_url || '';

      // Rebuild clause toggles from stored clause_slot data
      for (let i = 0; i < 9; i++) {
        form.value.clauseToggles[i] = !!(offer[`clause_slot_${i + 1}_title`]);
      }

      form.value.customClause1Title = offer.clause_slot_10_title || '';
      form.value.customClause1Text = offer.clause_slot_10_text || '';
      form.value.customClause2Title = offer.clause_slot_11_title || '';
      form.value.customClause2Text = offer.clause_slot_11_text || '';

      let lastFilled = 0;
      for (let i = 0; i < 8; i++) {
        form.value.milestones[i].name = offer[`m${i + 1}_name`] || '';
        form.value.milestones[i].delivers = offer[`m${i + 1}_delivers`] || '';
        form.value.milestones[i].clientDoes = offer[`m${i + 1}_client_does`] || '';
        if (form.value.milestones[i].name) lastFilled = i + 1;
      }
      visibleMilestoneCount.value = Math.min(8, Math.max(1, lastFilled + (lastFilled < 8 ? 1 : 0)));

      form.value.processorOverride = offer.processor_override || '';
      form.value.nmiProcessorId = offer.nmi_processor_id || '';
      form.value.checkoutMode = offer.checkout_mode || 'full_enrollment';
      form.value.quickCheckoutConsentText = offer.quick_checkout_consent_text || '';
      form.value.quickCheckoutShowDescription = offer.quick_checkout_show_description ?? true;
      form.value.quickCheckoutShowRefundPolicy = offer.quick_checkout_show_refund_policy ?? true;
      form.value.pulseCadenceEnabled = offer.pulse_cadence_enabled ?? true;
      form.value.pulseFrequencyDays = offer.pulse_frequency_days || 30;
    } catch {}
  }
});

watch(() => form.value.checkoutMode, (mode) => {
  if (!isEdit.value) {
    form.value.pulseCadenceEnabled = mode !== 'quick_checkout';
  }
});

async function save() {
  // Build clause arrays from toggles
  const clauses: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < 9; i++) {
    if (form.value.clauseToggles[i]) {
      clauses.push({ title: standardClauses[i].label, text: standardClauses[i].text });
    } else {
      clauses.push({ title: '', text: '' });
    }
  }
  // Slots 10-11: custom clauses
  clauses.push({ title: form.value.customClause1Title, text: form.value.customClause1Text });
  clauses.push({ title: form.value.customClause2Title, text: form.value.customClause2Text });

  const payload: any = {
    offerName: form.value.offerName,
    programDescription: form.value.programDescription,
    deliveryMethod: form.value.deliveryMethod,
    price: form.value.price,
    paymentType: form.value.paymentType,
    installmentAmount: form.value.paymentType === 'subscription'
      ? form.value.installmentAmount
      : undefined,
    installmentFrequency: form.value.installmentFrequency,
    numPayments: form.value.numPayments,
    pifPrice: form.value.pifDiscountEnabled ? form.value.pifPrice : 0,
    pifDiscountEnabled: form.value.pifDiscountEnabled,
    programDurationValue: form.value.programDurationValue,
    programDurationUnit: form.value.programDurationUnit,
    refundPolicyType: form.value.refundPolicyType,
    refundPolicyDays: form.value.refundPolicyDays,
    refundWindowText: form.value.refundWindowText,
    tcUrl: form.value.tcHasOwn ? form.value.tcUrl : '',
    clauses,
    milestones: form.value.milestones.filter(m => m.name),
    processorOverride: form.value.processorOverride || null,
    nmiProcessorId: form.value.nmiProcessorId || null,
    checkoutMode: form.value.checkoutMode,
    quickCheckoutConsentText: form.value.quickCheckoutConsentText || '',
    quickCheckoutShowDescription: form.value.quickCheckoutShowDescription,
    quickCheckoutShowRefundPolicy: form.value.quickCheckoutShowRefundPolicy,
    pulseCadenceEnabled: form.value.pulseCadenceEnabled,
    pulseFrequencyDays: form.value.pulseFrequencyDays,
  };

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
  accent-color: var(--ss-primary-500);
  flex-shrink: 0;
}

.clause-toggle {
  border-left: 3px solid var(--ss-navy-200);
  padding-left: 16px;
}

.clause-row {
  border-left: 3px solid var(--ss-primary-100);
  padding-left: 16px;
}

.readonly-field {
  background: var(--ss-navy-100) !important;
  color: var(--ss-navy-500) !important;
  cursor: not-allowed;
}

.checkout-mode-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.radio-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border: 2px solid var(--ss-navy-200);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.radio-card:hover {
  border-color: var(--ss-primary-300);
}

.radio-card.active {
  border-color: var(--ss-primary-500);
  background: var(--ss-primary-50);
}

.radio-card input[type="radio"] {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--ss-primary-500);
  flex-shrink: 0;
}

.quick-checkout-options {
  border-left: 3px solid var(--ss-primary-500);
  padding-left: 16px;
  margin-left: 8px;
}
</style>
