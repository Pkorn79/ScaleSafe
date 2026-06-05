<template>
  <Modal v-model:open="openProxy" title="Quick Manual Sale" max-width="680px" @close="resetTransient">
    <div class="qms-grid">
      <div class="form-group">
        <label class="form-label">First Name *</label>
        <input class="form-input" v-model="client.firstName" :readonly="clientLocked" />
      </div>
      <div class="form-group">
        <label class="form-label">Last Name</label>
        <input class="form-input" v-model="client.lastName" :readonly="clientLocked" />
      </div>
    </div>

    <div class="qms-grid">
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input class="form-input" type="email" v-model="client.email" :readonly="clientLocked" />
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" type="tel" v-model="client.phone" :readonly="clientLocked && !!client.phone" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Offer / Program</label>
      <select class="form-select" v-model="selectedOfferId">
        <option value="">Client-level payment only - no enrollment link</option>
        <option v-for="offer in activeOffers" :key="offer.id" :value="offer.id">
          {{ offer.offer_name }}
        </option>
      </select>
      <p class="text-sm text-muted mt-2">
        {{ selectedOfferId ? 'Payment now, enrollment packet after payment.' : 'This records a payment on the client only. No enrollment packet or welcome email is sent.' }}
      </p>
    </div>

    <div class="qms-grid">
      <div class="form-group">
        <label class="form-label">Payment Plan</label>
        <select class="form-select" v-model="paymentChoice" :disabled="!selectedOfferId">
          <option value="pif">Paid in full</option>
          <option value="installments" :disabled="!selectedOfferSupportsInstallments">Installment</option>
          <option value="subscription" :disabled="!selectedOfferSupportsSubscription">Subscription</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Amount *</label>
        <input class="form-input" type="number" min="0" step="0.01" v-model.number="amount" />
      </div>
    </div>
    <div v-if="dualPricingPreview" class="qms-dual-preview">
      <div><span>Bank Transfer price</span><strong>{{ dualPricingPreview.ach }}</strong></div>
      <div><span>Card price</span><strong>{{ dualPricingPreview.card }}</strong></div>
    </div>

    <label v-if="selectedOfferId" class="inline-check qms-check">
      <input type="checkbox" v-model="sendEnrollment" />
      Send paid enrollment link after payment
    </label>
    <p v-if="selectedOfferId && sendEnrollment" class="qms-help">
      Receipt sends after this payment. Welcome/access should send only after the client signs the paid enrollment packet.
    </p>

    <div class="qms-card-section">
      <div class="section-title">Payment Method</div>
      <div v-if="achToggleVisible" class="qms-method-toggle">
        <button type="button" :disabled="submitting" :class="{ active: paymentMethod === 'ach' }" @click="paymentMethod = 'ach'">Bank Transfer</button>
        <button type="button" :disabled="submitting" :class="{ active: paymentMethod === 'card' }" @click="paymentMethod = 'card'">Card</button>
      </div>
      <div v-if="configLoading" class="loading">Loading payment fields...</div>
      <div v-else-if="processorError" class="error-msg">{{ processorError }}</div>
      <template v-else>
        <div v-if="fieldMounting" class="text-sm text-muted mb-2">{{ fieldPrepMessage }}</div>
        <div v-if="processorType === 'nmi'" class="qms-nmi">
          <div v-show="paymentMethod === 'card'">
            <label class="form-label">Card Number</label>
            <div class="field-wrapper"><div :id="nmiIds.number"></div></div>
            <div class="qms-grid">
              <div>
                <label class="form-label">Exp Date</label>
                <div class="field-wrapper"><div :id="nmiIds.exp"></div></div>
              </div>
              <div>
                <label class="form-label">CVV</label>
                <div class="field-wrapper"><div :id="nmiIds.cvv"></div></div>
              </div>
            </div>
          </div>
          <div v-show="paymentMethod === 'ach'">
            <label class="form-label">Name on Bank Account</label>
            <div class="field-wrapper"><div :id="nmiIds.checkName"></div></div>
            <label class="form-label">Routing Number</label>
            <div class="field-wrapper"><div :id="nmiIds.checkAba"></div></div>
            <label class="form-label">Account Number</label>
            <div class="field-wrapper"><div :id="nmiIds.checkAccount"></div></div>
            <div class="qms-grid">
              <select class="form-select" v-model="achAccountHolderType">
                <option value="personal">Personal account</option>
                <option value="business">Business account</option>
              </select>
              <select class="form-select" v-model="achAccountType">
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
          </div>
        </div>
        <div v-else-if="processorType === 'stripe' && paymentMethod === 'card'">
          <div class="field-wrapper"><div :id="stripeElementId" :key="stripeMountKey"></div></div>
        </div>
        <div v-else-if="processorType === 'stripe' && paymentMethod === 'ach'" class="qms-ach-placeholder">
          Stripe opens secure bank account collection after you submit.
        </div>
        <div v-else class="error-msg">No processor is configured.</div>
      </template>
    </div>

    <div v-if="resultMessage" class="text-sm mt-2" style="color:#10b981">{{ resultMessage }}</div>
    <div v-if="submitError" class="text-sm mt-2" style="color:#ef4444">{{ submitError }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="openProxy = false" :disabled="submitting">Close</button>
      <button class="btn btn-primary" @click="submit" :disabled="submitting || !canSubmit">
        {{ submitting ? 'Submitting...' : (paymentMethod === 'ach' ? 'Submit Bank Payment' : 'Charge Card') }}
      </button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { useApi } from '../composables/useApi';

declare global {
  interface Window {
    Stripe?: any;
    CollectJS?: any;
  }
}

const props = defineProps<{
  open: boolean;
  initialClient?: {
    contactId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  } | null;
  clientLocked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'completed', value: any): void;
}>();

const api = useApi();

const openProxy = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const client = reactive({
  contactId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
});
const clientLocked = computed(() => props.clientLocked === true);

const activeOffers = ref<any[]>([]);
const selectedOfferId = ref('');
const paymentChoice = ref('pif');
const paymentMethod = ref<'card' | 'ach'>('card');
const achAccountHolderType = ref<'personal' | 'business'>('personal');
const achAccountType = ref<'checking' | 'savings'>('checking');
const amount = ref<number | null>(null);
const sendEnrollment = ref(true);
const configLoading = ref(false);
const fieldMounting = ref(false);
const paymentFieldsReady = ref(false);
const processorType = ref('');
const processorError = ref('');
const submitting = ref(false);
const submitError = ref('');
const resultMessage = ref('');
const dualPricingConfig = ref<{ enabled: boolean; cardUpliftPercent: number; processorDeductionPercent: number } | null>(null);
const completedSuccessfully = ref(false);

const nonce = Math.random().toString(36).slice(2);
const nmiIds = {
  number: `qms-cc-number-${nonce}`,
  exp: `qms-cc-exp-${nonce}`,
  cvv: `qms-cc-cvv-${nonce}`,
  checkName: `qms-check-name-${nonce}`,
  checkAba: `qms-check-aba-${nonce}`,
  checkAccount: `qms-check-account-${nonce}`,
};
const stripeElementId = `qms-card-element-${nonce}`;
const stripeMountKey = ref(0);
let stripe: any = null;
let cardElement: any = null;
let nmiTokenResolver: ((token: string) => void) | null = null;
let nmiTokenRejecter: ((err: Error) => void) | null = null;
let processorLoadSeq = 0;

const selectedOffer = computed(() => activeOffers.value.find((offer) => offer.id === selectedOfferId.value) || null);
const selectedOfferSupportsInstallments = computed(() => {
  const offer = selectedOffer.value;
  return ['installment', 'installments'].includes(String(offer?.payment_type || '').toLowerCase());
});
const selectedOfferSupportsSubscription = computed(() => {
  const offer = selectedOffer.value;
  return String(offer?.payment_type || '').toLowerCase() === 'subscription';
});
const canSubmit = computed(() => {
  return Boolean(
    client.firstName
    && client.email
    && amount.value
    && Number(amount.value) > 0
    && processorType.value
    && paymentFieldsReady.value
    && !processorError.value
    && !completedSuccessfully.value,
  );
});

function applyInitialClient() {
  const initial = props.initialClient || {};
  client.contactId = initial.contactId || '';
  client.firstName = initial.firstName || '';
  client.lastName = initial.lastName || '';
  client.email = initial.email || '';
  client.phone = initial.phone || '';
}

function defaultAmountForOffer(offer: any, choice: string): number | null {
  if (!offer) return null;
  if (choice === 'installments') return Number(offer.installment_amount ?? offer.price ?? 0);
  if (choice === 'subscription') return Number(offer.installment_amount ?? offer.price ?? 0);
  if (offer.pif_discount_enabled && offer.pif_price != null) return Number(offer.pif_price);
  return Number(offer.price || 0);
}

function dualPricingQuoteForOffer(offer: any, choice: string) {
  const cfg = dualPricingConfig.value;
  if (!offer || !cfg?.enabled || !offer.dual_pricing_enabled || !offer.ach_enabled) return null;
  const achAmount = defaultAmountForOffer(offer, choice) || 0;
  const uplift = Number(cfg.cardUpliftPercent || 0);
  const cardAmount = uplift > 0 ? achAmount * (1 + uplift / 100) : achAmount;
  return { cardAmount, achAmount };
}

function selectedAmountForOffer(offer: any, choice: string): number | null {
  const base = defaultAmountForOffer(offer, choice);
  const quote = dualPricingQuoteForOffer(offer, choice);
  if (!quote) return base;
  return paymentMethod.value === 'ach' ? Number(quote.achAmount.toFixed(2)) : Number(quote.cardAmount.toFixed(2));
}

const dualPricingPreview = computed(() => {
  const quote = dualPricingQuoteForOffer(selectedOffer.value, paymentChoice.value);
  if (!quote) return null;
  return {
    card: `$${quote.cardAmount.toFixed(2)}`,
    ach: `$${quote.achAmount.toFixed(2)}`,
  };
});
const fieldPrepMessage = computed(() => (
  paymentMethod.value === 'ach'
    ? 'Preparing secure bank payment...'
    : 'Preparing secure card fields...'
));
const processorLoading = computed(() => configLoading.value || fieldMounting.value);
const achAllowedForSelection = computed(() => {
  return Boolean(dualPricingPreview.value
    && (processorType.value === 'stripe' || processorType.value === 'nmi'));
});
const achToggleVisible = computed(() => Boolean(dualPricingPreview.value && (
  processorType.value === 'stripe'
  || processorType.value === 'nmi'
  || (processorLoading.value && paymentMethod.value === 'ach')
)));

function normalizeOfferChoice(offer: any): string {
  const type = String(offer?.payment_type || '').toLowerCase();
  if (type === 'installment' || type === 'installments') return 'installments';
  if (type === 'subscription') return 'subscription';
  return 'pif';
}

async function loadOffers() {
  const offers = await api.get<any[]>('/api/offers');
  activeOffers.value = (offers || []).filter((offer) => offer.active);
  try {
    dualPricingConfig.value = await api.get<any>('/api/offers/dual-pricing/config');
  } catch {
    dualPricingConfig.value = null;
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    const existing = Array.from(document.scripts).find((script) => script.src === src);
    if (existing) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function animationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function cardTargetExists(): boolean {
  if (processorType.value === 'stripe') {
    return paymentMethod.value === 'ach' || !!document.getElementById(stripeElementId);
  }
  if (processorType.value === 'nmi') {
    return Boolean(
      document.getElementById(nmiIds.number)
      && document.getElementById(nmiIds.exp)
      && document.getElementById(nmiIds.cvv)
      && document.getElementById(nmiIds.checkName)
      && document.getElementById(nmiIds.checkAba)
      && document.getElementById(nmiIds.checkAccount),
    );
  }
  return false;
}

function cleanupPaymentFields() {
  paymentFieldsReady.value = false;
  nmiTokenResolver = null;
  nmiTokenRejecter = null;
  if (cardElement) {
    try { cardElement.unmount(); } catch {}
    try { cardElement.destroy?.(); } catch {}
    cardElement = null;
  }
  stripe = null;
  stripeMountKey.value += 1;
}

async function loadCollectJs(tokenizationKey: string) {
  const src = 'https://secure.nmi.com/token/Collect.js';
  const existing = Array.from(document.scripts).find((script) => script.src === src);
  if (existing && existing.getAttribute('data-tokenization-key') === tokenizationKey && window.CollectJS) return;
  if (existing) existing.remove();
  window.CollectJS = undefined;
  await loadScript(src, { 'data-tokenization-key': tokenizationKey });
}

async function loadProcessorConfig() {
  const seq = ++processorLoadSeq;
  configLoading.value = true;
  fieldMounting.value = false;
  processorError.value = '';
  processorType.value = '';
  cleanupPaymentFields();
  try {
    const params = new URLSearchParams();
    if (selectedOfferId.value) params.set('offerId', selectedOfferId.value);
    const cfg = await api.get<any>(`/api/dashboard/manual-sale/config?${params.toString()}`);
    if (seq !== processorLoadSeq || !props.open) return;
    processorType.value = cfg.processorType || '';
    if (processorType.value !== 'nmi' && processorType.value !== 'stripe') paymentMethod.value = 'card';
    configLoading.value = false;
    fieldMounting.value = true;
    await nextTick();
    await animationFrame();
    await animationFrame();
    if (seq !== processorLoadSeq || !props.open) return;
    if (!cardTargetExists()) throw new Error('Secure card fields were not ready. Please close and reopen Quick Manual Sale.');

    if (processorType.value === 'nmi') {
      if (!cfg.nmiTokenizationKey) throw new Error('NMI tokenization key is missing.');
      await loadCollectJs(cfg.nmiTokenizationKey);
      if (seq !== processorLoadSeq || !props.open) return;
      if (!window.CollectJS) throw new Error('NMI card fields did not load.');
      window.CollectJS.configure({
        variant: 'inline',
        fields: {
          ccnumber: { selector: `#${nmiIds.number}`, placeholder: 'Card Number' },
          ccexp: { selector: `#${nmiIds.exp}`, placeholder: 'MM/YY' },
          cvv: { selector: `#${nmiIds.cvv}`, placeholder: 'CVV' },
          checkname: { selector: `#${nmiIds.checkName}`, placeholder: 'Name on account' },
          checkaba: { selector: `#${nmiIds.checkAba}`, placeholder: 'Routing number' },
          checkaccount: { selector: `#${nmiIds.checkAccount}`, placeholder: 'Account number' },
        },
        customCss: {
          border: 'none',
          height: '100%',
          width: '100%',
          'font-size': '16px',
          color: '#1f2937',
          outline: 'none',
          'background-color': '#ffffff',
        },
        invalidCss: { color: '#ef4444' },
        placeholderCss: { color: '#9ca3af' },
        timeoutCallback: () => {
          if (nmiTokenRejecter) nmiTokenRejecter(new Error('Card input timed out. Please try again.'));
        },
        callback: (response: any) => {
          if (nmiTokenResolver && response?.token) nmiTokenResolver(response.token);
          else if (nmiTokenRejecter) nmiTokenRejecter(new Error('Card tokenization failed.'));
          nmiTokenResolver = null;
          nmiTokenRejecter = null;
        },
      });
      paymentFieldsReady.value = true;
    } else if (processorType.value === 'stripe') {
      if (!cfg.stripePublishableKey) throw new Error('Stripe publishable key is missing.');
      await loadScript('https://js.stripe.com/v3/');
      if (seq !== processorLoadSeq || !props.open) return;
      if (!window.Stripe) throw new Error('Stripe card fields did not load.');
      stripe = window.Stripe(cfg.stripePublishableKey, cfg.stripeAccountId ? { stripeAccount: cfg.stripeAccountId } : undefined);
      if (paymentMethod.value === 'ach') {
        paymentFieldsReady.value = true;
      } else {
        const elements = stripe.elements();
        cardElement = elements.create('card', { hidePostalCode: true });
        cardElement.on('ready', () => {
          if (seq === processorLoadSeq) paymentFieldsReady.value = true;
        });
        cardElement.mount(`#${stripeElementId}`);
      }
    } else {
      throw new Error('No processor is configured.');
    }
  } catch (err: any) {
    if (seq !== processorLoadSeq) return;
    processorError.value = err.message || 'Payment fields could not load.';
  } finally {
    if (seq === processorLoadSeq) {
      configLoading.value = false;
      fieldMounting.value = false;
    }
  }
}

function getNmiToken() {
  return new Promise<string>((resolve, reject) => {
    nmiTokenResolver = resolve;
    nmiTokenRejecter = reject;
    window.CollectJS?.startPaymentRequest();
    window.setTimeout(() => {
      if (nmiTokenResolver) {
        nmiTokenResolver = null;
        nmiTokenRejecter = null;
        reject(new Error('Card tokenization timed out.'));
      }
    }, 10000);
  });
}

async function tokenizeCard(): Promise<string> {
  if (!paymentFieldsReady.value) throw new Error('Payment fields are not ready yet.');
  if (processorType.value === 'stripe' && paymentMethod.value === 'ach') {
    return '';
  }
  if (processorType.value === 'stripe') {
    const result = await stripe.createPaymentMethod({
      type: 'card',
      card: cardElement,
      billing_details: {
        name: [client.firstName, client.lastName].filter(Boolean).join(' '),
        email: client.email,
        phone: client.phone || undefined,
      },
    });
    if (result.error) throw new Error(result.error.message);
    return result.paymentMethod.id;
  }
  if (processorType.value === 'nmi') {
    return getNmiToken();
  }
  throw new Error('Payment fields are not ready.');
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  submitError.value = '';
  resultMessage.value = '';
  try {
    if (processorType.value === 'stripe' && paymentMethod.value === 'ach') {
      if (!stripe || !stripe.collectBankAccountForPayment) throw new Error('Stripe bank transfer is not ready.');
      resultMessage.value = 'Opening secure Stripe bank account collection...';
      const intent = await api.post<any>('/api/dashboard/manual-sale/stripe-ach/intent', {
        contactId: client.contactId || undefined,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
        offerId: selectedOfferId.value || undefined,
        amount: amount.value,
        paymentType: paymentChoice.value,
        paymentMethod: 'ach',
        sendEnrollment: selectedOfferId.value ? sendEnrollment.value : false,
        sendVia: ['email'],
      });

      const bankResult = await stripe.collectBankAccountForPayment({
        clientSecret: intent.clientSecret,
        params: {
          payment_method_type: 'us_bank_account',
          payment_method_data: {
            billing_details: {
              name: [client.firstName, client.lastName].filter(Boolean).join(' '),
              email: client.email,
              phone: client.phone || undefined,
            },
          },
        },
        expand: ['payment_method'],
      });
      if (bankResult.error) throw new Error(bankResult.error.message);

      let paymentIntent = bankResult.paymentIntent;
      if (!paymentIntent) throw new Error('Stripe did not return a bank payment intent. Please try again.');
      if (['requires_payment_method', 'canceled'].includes(String(paymentIntent.status || ''))) {
        throw new Error('Bank account collection was not completed.');
      }
      if (paymentIntent && paymentIntent.status === 'requires_confirmation') {
        resultMessage.value = 'Confirming bank payment with Stripe...';
        const confirmResult = await stripe.confirmUsBankAccountPayment(intent.clientSecret);
        if (confirmResult.error) throw new Error(confirmResult.error.message);
        paymentIntent = confirmResult.paymentIntent;
      }
      if (!paymentIntent?.id) throw new Error('Stripe did not return a confirmed bank payment. Please try again.');
      if (['requires_payment_method', 'requires_confirmation', 'canceled'].includes(String(paymentIntent.status || ''))) {
        throw new Error('Bank payment was not submitted. Please complete the Stripe bank account flow and try again.');
      }

      resultMessage.value = 'Recording bank payment in ScaleSafe...';
      const finalized = await api.post<any>('/api/dashboard/manual-sale/stripe-ach/finalize', {
        paymentIntentId: paymentIntent?.id || intent.paymentIntentId,
      });
      if (finalized.success === false || finalized.paymentStatus === 'failed') {
        throw new Error(finalized.error || 'Stripe bank payment was not accepted.');
      }
      resultMessage.value = finalized.paymentStatus === 'settled'
        ? (selectedOfferId.value ? 'Bank payment settled. Paid enrollment link is ready.' : 'Bank payment settled and saved to the client.')
        : 'Bank transfer submitted. Receipt and enrollment link send after Stripe confirms success.';
      completedSuccessfully.value = true;
      emit('completed', finalized);
      return;
    }

    const paymentToken = await tokenizeCard();
    const result = await api.post<any>('/api/dashboard/manual-sale/charge', {
      contactId: client.contactId || undefined,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      offerId: selectedOfferId.value || undefined,
      amount: amount.value,
      paymentToken,
      paymentType: paymentChoice.value,
      paymentMethod: paymentMethod.value,
      achAccountHolderType: paymentMethod.value === 'ach' ? achAccountHolderType.value : undefined,
      achAccountType: paymentMethod.value === 'ach' ? achAccountType.value : undefined,
      achSecCode: paymentMethod.value === 'ach' ? 'WEB' : undefined,
      sendEnrollment: selectedOfferId.value ? sendEnrollment.value : false,
      sendVia: ['email'],
    });
    if (result.billingIssue?.message) {
      resultMessage.value = `Payment received, but subscription setup failed: ${result.billingIssue.message}`;
    } else if (result.recordingIssue?.message) {
      resultMessage.value = `Payment received, but ScaleSafe could not finish recording: ${result.recordingIssue.message}`;
    } else {
      resultMessage.value = selectedOfferId.value
        ? (result.paymentStatus === 'processing' ? 'Bank transfer submitted. Enrollment will complete after settlement.' : 'Payment received. Paid enrollment link is ready.')
        : (result.paymentStatus === 'processing' ? 'Bank transfer submitted. Receipt will send after settlement.' : 'Payment received and saved to the client.');
    }
    completedSuccessfully.value = true;
    emit('completed', result);
  } catch (err: any) {
    submitError.value = err.message || 'Payment failed.';
  } finally {
    if (!completedSuccessfully.value) submitting.value = false;
  }
}

function resetTransient() {
  submitError.value = '';
  resultMessage.value = '';
  completedSuccessfully.value = false;
  submitting.value = false;
}

watch(() => props.open, async (open) => {
  if (!open) {
    processorLoadSeq++;
    cleanupPaymentFields();
    return;
  }
  applyInitialClient();
  selectedOfferId.value = '';
  paymentChoice.value = 'pif';
  paymentMethod.value = 'card';
  achAccountHolderType.value = 'personal';
  achAccountType.value = 'checking';
  amount.value = null;
  sendEnrollment.value = true;
  resetTransient();
  if (activeOffers.value.length === 0) await loadOffers();
  await loadProcessorConfig();
});

watch(selectedOfferId, async () => {
  resetTransient();
  const offer = selectedOffer.value;
  paymentChoice.value = offer ? normalizeOfferChoice(offer) : 'pif';
  amount.value = offer ? selectedAmountForOffer(offer, paymentChoice.value) : null;
  if (props.open) await loadProcessorConfig();
});

watch(paymentChoice, () => {
  resetTransient();
  if (selectedOffer.value) amount.value = selectedAmountForOffer(selectedOffer.value, paymentChoice.value);
});

watch(paymentMethod, async () => {
  resetTransient();
  if (!achAllowedForSelection.value && !processorLoading.value && paymentMethod.value === 'ach') paymentMethod.value = 'card';
  if (selectedOffer.value) amount.value = selectedAmountForOffer(selectedOffer.value, paymentChoice.value);
  if (props.open && processorType.value === 'stripe') await loadProcessorConfig();
});

watch(achAllowedForSelection, (allowed) => {
  if (!allowed && !processorLoading.value && paymentMethod.value === 'ach') paymentMethod.value = 'card';
});
</script>

<style scoped>
.qms-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.qms-check {
  margin: 2px 0 8px;
}

.qms-help {
  background: var(--ss-primary-50);
  border: 1px solid var(--ss-primary-100);
  border-radius: 8px;
  color: var(--ss-primary-800);
  font-size: 13px;
  line-height: 1.45;
  margin: 0 0 16px;
  padding: 9px 11px;
}

.qms-card-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
}

.qms-method-toggle {
  display: flex;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
}

.qms-method-toggle button {
  flex: 1;
  border: 0;
  background: #f8fafc;
  color: #374151;
  cursor: pointer;
  font-size: 14px;
  font-weight: 650;
  padding: 10px;
}

.qms-method-toggle button.active {
  background: #2563eb;
  color: #fff;
}

.qms-dual-preview {
  background: #f8fafc;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  color: #475569;
  font-size: 13px;
  margin: 0 0 14px;
  padding: 11px;
}

.qms-dual-preview div {
  display: flex;
  justify-content: space-between;
  margin: 3px 0;
}

.qms-dual-preview strong {
  color: #111827;
}

.qms-ach-placeholder {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #475569;
  font-size: 13px;
  padding: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 650;
  color: #475569;
  margin-bottom: 10px;
}

.field-wrapper {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
  min-height: 44px;
  background: #fff;
}

.field-wrapper:focus-within {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

@media (max-width: 640px) {
  .qms-grid {
    grid-template-columns: 1fr;
  }
}
</style>
