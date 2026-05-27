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
        <option value="">No offer - client-level payment only</option>
        <option v-for="offer in activeOffers" :key="offer.id" :value="offer.id">
          {{ offer.offer_name }}
        </option>
      </select>
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

    <label v-if="selectedOfferId" class="inline-check qms-check">
      <input type="checkbox" v-model="sendEnrollment" />
      Send paid enrollment link after payment
    </label>

    <div class="qms-card-section">
      <div class="section-title">Card</div>
      <div v-if="configLoading" class="loading">Loading payment fields...</div>
      <div v-else-if="processorError" class="error-msg">{{ processorError }}</div>
      <template v-else>
        <div v-show="processorType === 'nmi'" class="qms-nmi">
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
        <div v-show="processorType === 'stripe'">
          <div class="field-wrapper"><div :id="stripeElementId"></div></div>
        </div>
      </template>
    </div>

    <div v-if="resultMessage" class="text-sm mt-2" style="color:#10b981">{{ resultMessage }}</div>
    <div v-if="submitError" class="text-sm mt-2" style="color:#ef4444">{{ submitError }}</div>

    <template #footer>
      <button class="btn btn-secondary" @click="openProxy = false" :disabled="submitting">Close</button>
      <button class="btn btn-primary" @click="submit" :disabled="submitting || !canSubmit">
        {{ submitting ? 'Charging...' : 'Charge Card' }}
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
const amount = ref<number | null>(null);
const sendEnrollment = ref(true);
const configLoading = ref(false);
const processorType = ref('');
const processorError = ref('');
const submitting = ref(false);
const submitError = ref('');
const resultMessage = ref('');

const nonce = Math.random().toString(36).slice(2);
const nmiIds = {
  number: `qms-cc-number-${nonce}`,
  exp: `qms-cc-exp-${nonce}`,
  cvv: `qms-cc-cvv-${nonce}`,
};
const stripeElementId = `qms-card-element-${nonce}`;
let stripe: any = null;
let cardElement: any = null;
let nmiTokenResolver: ((token: string) => void) | null = null;
let nmiTokenRejecter: ((err: Error) => void) | null = null;

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
  return Boolean(client.firstName && client.email && amount.value && Number(amount.value) > 0 && processorType.value && !processorError.value);
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

function normalizeOfferChoice(offer: any): string {
  const type = String(offer?.payment_type || '').toLowerCase();
  if (type === 'installment' || type === 'installments') return 'installments';
  if (type === 'subscription') return 'subscription';
  return 'pif';
}

async function loadOffers() {
  const offers = await api.get<any[]>('/api/offers');
  activeOffers.value = (offers || []).filter((offer) => offer.active);
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

async function loadProcessorConfig() {
  configLoading.value = true;
  processorError.value = '';
  processorType.value = '';
  try {
    const params = new URLSearchParams();
    if (selectedOfferId.value) params.set('offerId', selectedOfferId.value);
    const cfg = await api.get<any>(`/api/dashboard/manual-sale/config?${params.toString()}`);
    processorType.value = cfg.processorType || '';
    await nextTick();

    if (processorType.value === 'nmi') {
      if (!cfg.nmiTokenizationKey) throw new Error('NMI tokenization key is missing.');
      await loadScript('https://secure.nmi.com/token/Collect.js', { 'data-tokenization-key': cfg.nmiTokenizationKey });
      if (!window.CollectJS) throw new Error('NMI card fields did not load.');
      window.CollectJS.configure({
        variant: 'inline',
        fields: {
          ccnumber: { selector: `#${nmiIds.number}`, placeholder: 'Card Number' },
          ccexp: { selector: `#${nmiIds.exp}`, placeholder: 'MM/YY' },
          cvv: { selector: `#${nmiIds.cvv}`, placeholder: 'CVV' },
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
    } else if (processorType.value === 'stripe') {
      if (!cfg.stripePublishableKey) throw new Error('Stripe publishable key is missing.');
      await loadScript('https://js.stripe.com/v3/');
      if (!window.Stripe) throw new Error('Stripe card fields did not load.');
      stripe = window.Stripe(cfg.stripePublishableKey, cfg.stripeAccountId ? { stripeAccount: cfg.stripeAccountId } : undefined);
      const elements = stripe.elements();
      if (cardElement) cardElement.unmount();
      cardElement = elements.create('card', { hidePostalCode: true });
      cardElement.mount(`#${stripeElementId}`);
    } else {
      throw new Error('No processor is configured.');
    }
  } catch (err: any) {
    processorError.value = err.message || 'Payment fields could not load.';
  } finally {
    configLoading.value = false;
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
  submitting.value = true;
  submitError.value = '';
  resultMessage.value = '';
  try {
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
      sendEnrollment: selectedOfferId.value ? sendEnrollment.value : false,
      sendVia: ['email'],
    });
    resultMessage.value = selectedOfferId.value
      ? 'Payment received. Paid enrollment link is ready.'
      : 'Payment received and saved to the client.';
    emit('completed', result);
  } catch (err: any) {
    submitError.value = err.message || 'Payment failed.';
  } finally {
    submitting.value = false;
  }
}

function resetTransient() {
  submitError.value = '';
  resultMessage.value = '';
}

watch(() => props.open, async (open) => {
  if (!open) return;
  applyInitialClient();
  selectedOfferId.value = '';
  paymentChoice.value = 'pif';
  amount.value = null;
  sendEnrollment.value = true;
  resetTransient();
  if (activeOffers.value.length === 0) await loadOffers();
  await loadProcessorConfig();
});

watch(selectedOfferId, async () => {
  const offer = selectedOffer.value;
  paymentChoice.value = offer ? normalizeOfferChoice(offer) : 'pif';
  amount.value = offer ? defaultAmountForOffer(offer, paymentChoice.value) : null;
  if (props.open) await loadProcessorConfig();
});

watch(paymentChoice, () => {
  if (selectedOffer.value) amount.value = defaultAmountForOffer(selectedOffer.value, paymentChoice.value);
});
</script>

<style scoped>
.qms-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.qms-check {
  margin: 2px 0 16px;
}

.qms-card-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
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
