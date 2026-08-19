<template>
  <div class="settings-payments">
    <SectionHeader
      eyebrow="Settings"
      :title="['Payment', 'processing.']"
      description="Connect your payment processor to enable checkout through ScaleSafe."
    />

    <div v-if="loadError" class="error-msg">{{ loadError }}</div>
    <div v-if="pageLoading" class="loading">Loading processor status...</div>

    <template v-if="!pageLoading">
      <div class="card">
        <div class="flex-between">
          <div>
            <h3 class="section-title" style="margin-bottom:0">Marketplace Plan</h3>
            <p class="text-sm text-muted mt-2">{{ ssoSession.entitlement.planLabel }}</p>
          </div>
          <span class="badge badge-green">Active</span>
        </div>
        <p class="text-sm text-muted mt-2">{{ ssoSession.entitlement.message }}</p>
      </div>

      <!-- Default Processor Toggle (only show if both connected) -->
      <div v-if="nmiConnected && stripeConnected" class="card">
        <h3 class="section-title">Default Processor</h3>
        <p class="text-sm text-muted mb-4">Choose which processor handles new payments by default. You can override this per offer.</p>
        <div class="flex gap-2">
          <button
            class="btn"
            :class="defaultProcessor === 'nmi' ? 'btn-primary' : 'btn-secondary'"
            :disabled="!nmiPlanAvailable"
            @click="setDefaultProcessor('nmi')"
          >
            NMI
          </button>
          <button
            class="btn"
            :class="defaultProcessor === 'stripe' ? 'btn-primary' : 'btn-secondary'"
            @click="setDefaultProcessor('stripe')"
          >
            Stripe
          </button>
        </div>
      </div>

      <div class="card">
        <div class="flex-between mb-4">
          <div>
            <h3 class="section-title" style="margin-bottom:0">Dual Pricing Rate</h3>
            <p class="text-sm text-muted mt-2">Applies only to this merchant. Offers still turn dual pricing on or off individually.</p>
          </div>
          <span v-if="dualPricingConfig.locationScoped" class="badge badge-green">Merchant rate</span>
          <span v-else class="badge badge-yellow">Default rate</span>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Card price uplift (%)</label>
            <input
              class="form-input"
              v-model="dualPricingForm.cardUpliftPercent"
              type="number"
              min="0"
              max="10"
              step="0.01"
              placeholder="3.00"
            />
          </div>
          <div class="form-group">
            <label class="form-label">Processor deduction</label>
            <input class="form-input readonly-field" :value="dualPricingDeductionLabel" readonly />
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" @click="saveDualPricing" :disabled="dualPricingSaving">
            {{ dualPricingSaving ? 'Saving...' : 'Save Rate' }}
          </button>
        </div>
        <p v-if="dualPricingMessage" class="text-sm mt-2" :style="{ color: dualPricingMessageOk ? '#059669' : '#dc2626' }">
          {{ dualPricingMessage }}
        </p>
      </div>

      <!-- NMI Connection -->
      <div class="card">
        <div class="flex-between mb-4">
          <div>
            <h3 class="section-title" style="margin-bottom:0">NMI</h3>
            <p class="text-sm text-muted mt-2">Add one or more NMI merchant accounts/MID routes. Each offer can use the default route or a specific named route.</p>
          </div>
          <span v-if="nmiConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div v-if="nmiConfigs.length" class="nmi-route-list mb-4">
          <div v-for="route in nmiConfigs" :key="route.id" class="nmi-route-row">
            <div>
              <div class="route-title">
                {{ route.label }}
                <span v-if="route.isDefault" class="badge badge-green">Default</span>
              </div>
              <p class="text-sm text-muted">
                Processor ID: {{ route.nmiProcessorId || 'Gateway default' }}
              </p>
              <p class="text-sm text-muted">
                Tokenization: {{ route.hasTokenizationKey ? 'configured' : 'missing' }} · Webhook: {{ route.webhookStatus.replace(/_/g, ' ') }}
              </p>
            </div>
            <div class="route-actions">
              <button v-if="!route.isDefault" class="btn btn-secondary btn-sm" :disabled="!nmiPlanAvailable" @click="setDefaultNmiRoute(route.id)">
                Make Default
              </button>
              <button class="btn btn-danger btn-sm" @click="deactivateNmiRoute(route)">
                Remove
              </button>
            </div>
          </div>
        </div>

        <div v-if="nmiPlanAvailable">
          <h4 class="subsection-title mb-4">{{ nmiConnected ? 'Add NMI Route' : 'Connect NMI' }}</h4>
          <div class="form-group">
            <label class="form-label">Route Name</label>
            <input
              class="form-input"
              v-model="nmiForm.label"
              type="text"
              placeholder="Example: Main MID, High Ticket MID, ACH MID"
            />
            <p class="text-sm text-muted mt-2">This name is only used inside ScaleSafe so offers can choose the right NMI route.</p>
          </div>
          <div class="form-group">
            <label class="form-label">Security Key</label>
            <input
              class="form-input"
              v-model="nmiForm.securityKey"
              type="password"
              placeholder="Enter your NMI Security Key"
            />
            <p class="text-sm text-muted mt-2">Found in NMI Dashboard > Settings > Security Keys</p>
          </div>
          <div class="form-group">
            <label class="form-label">Tokenization Key</label>
            <input
              class="form-input"
              v-model="nmiForm.tokenizationKey"
              type="text"
              placeholder="Enter your Collect.js Tokenization Key"
            />
            <p class="text-sm text-muted mt-2">Found in NMI Dashboard > Settings > Collect.js</p>
          </div>
          <div class="form-group">
            <label class="form-label">Processor ID</label>
            <input
              class="form-input"
              v-model="nmiForm.processorId"
              type="text"
              placeholder="NMI processor_id for this MID route"
            />
            <p class="text-sm text-muted mt-2">Found in NMI Settings > Transaction Routing. Leave blank only for the gateway default route.</p>
          </div>
          <label class="checkbox-row mb-4">
            <input type="checkbox" v-model="nmiForm.isDefault" />
            <span>Make this the default NMI route</span>
          </label>
          <div class="flex gap-2">
            <button class="btn btn-primary" @click="connectNmi" :disabled="saving">
              {{ saving ? 'Saving...' : (nmiConnected ? 'Add Route' : 'Connect NMI') }}
            </button>
            <button class="btn btn-secondary" @click="testNmiConnection" :disabled="testing">
              {{ testing ? 'Testing...' : 'Test Connection' }}
            </button>
          </div>
          <div v-if="nmiTestResult" class="mt-2 text-sm" :style="{ color: nmiTestResult.success ? '#059669' : '#dc2626' }">
            {{ nmiTestResult.message }}
          </div>
        </div>
        <div v-else class="webhook-panel">
          <h4 class="subsection-title">WholePay approval required</h4>
          <p class="text-sm text-muted mt-2">
            New NMI setup is available only on the $59 WholePay plan after ScaleSafe HQ
            verifies the merchant's WholePay-provisioned NMI account. Stripe and Whop remain
            available on the standard plan.
          </p>
        </div>

        <div v-if="nmiConnected">
          <div class="webhook-panel mt-4">
            <div class="flex-between mb-2">
              <h4 class="subsection-title">Official NMI Webhook</h4>
              <span v-if="nmiWebhook?.status" class="badge" :class="nmiWebhook.status === 'verified' ? 'badge-green' : 'badge-yellow'">
                {{ nmiWebhook.status.replace(/_/g, ' ') }}
              </span>
            </div>
            <div v-if="nmiWebhookLoading" class="text-sm text-muted">Loading webhook setup...</div>
            <template v-else-if="nmiWebhook">
              <div class="setup-row">
                <label>Callback URL</label>
                <div class="copy-line">
                  <input class="form-input mono" :value="nmiWebhook.callbackUrl" readonly />
                  <button class="btn btn-secondary btn-sm" @click="copyText(nmiWebhook.callbackUrl)">Copy</button>
                </div>
              </div>
              <div class="setup-row">
                <label>NMI Webhook Key</label>
                <div class="copy-line">
                  <input
                    class="form-input mono"
                    :type="showNmiWebhookKey ? 'text' : 'password'"
                    v-model="nmiWebhookKeyInput"
                    :placeholder="nmiWebhook.hasKey ? 'Key saved. Paste a new key to replace it.' : 'Paste the key from NMI Webhooks'"
                  />
                  <button class="btn btn-secondary btn-sm" @click="showNmiWebhookKey = !showNmiWebhookKey">
                    {{ showNmiWebhookKey ? 'Hide' : 'Show' }}
                  </button>
                  <button class="btn btn-primary btn-sm" @click="saveNmiWebhookKey" :disabled="nmiWebhookSaving">
                    {{ nmiWebhookSaving ? 'Saving...' : 'Save Key' }}
                  </button>
                </div>
                <p class="text-sm text-muted mt-2">
                  Use the signing key shown in NMI Webhooks. ScaleSafe uses it to verify official event signatures.
                </p>
              </div>
              <div class="setup-row">
                <label>Required events</label>
                <div class="event-list">
                  <span v-for="event in nmiWebhook.events" :key="event" class="event-pill">{{ event }}</span>
                </div>
              </div>
              <p class="text-sm text-muted">Signature header: <span class="mono">Webhook-Signature</span></p>
              <p v-if="nmiWebhook.lastVerifiedAt" class="text-sm text-muted">Last verified: {{ formatDateTime(nmiWebhook.lastVerifiedAt) }}</p>
              <p v-if="nmiWebhook.lastError" class="text-sm" style="color:#dc2626">{{ nmiWebhook.lastError }}</p>
              <div class="flex gap-2 mt-2">
                <button class="btn btn-secondary btn-sm" @click="loadNmiWebhook">Refresh</button>
              </div>
              <p v-if="nmiWebhookMessage" class="text-sm mt-2" style="color:#059669">{{ nmiWebhookMessage }}</p>
            </template>
            <p v-else class="text-sm text-muted">Webhook setup values are not available yet.</p>
          </div>
          <button class="btn btn-danger btn-sm mt-2" @click="disconnectNmi">Disconnect All NMI Routes</button>
        </div>
      </div>

      <!-- Stripe Connection -->
      <div class="card">
        <div class="flex-between mb-4">
          <h3 class="section-title" style="margin-bottom:0">Stripe</h3>
          <div class="flex gap-2">
            <span v-if="stripeConnected" class="badge badge-green">Connected</span>
            <span v-else-if="stripeAccountId && !stripeModeMatches" class="badge badge-red">Reconnect Required</span>
            <span v-else class="badge badge-gray">Not Connected</span>
          </div>
        </div>

        <div v-if="!stripeConnected">
          <p v-if="stripeAccountId && !stripeModeMatches" class="text-sm mb-4" style="color:#b91c1c">
            This saved Stripe connection is no longer valid for payments. Reconnect Stripe before accepting payments.
          </p>
          <p class="text-sm text-muted mb-4">Connect your existing Stripe account to enable payment processing and dispute defense.</p>
          <p class="text-sm mb-4" style="color: var(--ss-primary-700)">Connecting Stripe gives you instant access to your risk profile and defense tools.</p>
          <div class="stripe-ach-setup mb-4">
            <h4 class="subsection-title">ACH setup in Stripe</h4>
            <ol class="setup-list">
              <li>Open Stripe Dashboard, then click the gear icon.</li>
              <li>Under Product settings, open Payments > Payment methods.</li>
              <li>Select Default if Stripe shows that option.</li>
              <li>If ACH is not visible, scroll through Regional and international payment options.</li>
              <li>Under United States, turn on ACH Direct Debit / US bank account.</li>
              <li>Complete any business verification Stripe asks for so ACH can move to active.</li>
              <li>After ACH is active, connect Stripe here and enable dual pricing on eligible offers.</li>
            </ol>
            <p class="text-sm text-muted mt-2">
              For Standard Stripe accounts, this is handled in the merchant's Stripe Dashboard. For Express or Custom connected accounts, Stripe requires the ACH capability named us_bank_account_ach_payments.
            </p>
          </div>
          <button class="btn btn-primary" @click="connectStripe">
            Connect with Stripe
          </button>
        </div>

        <div v-else>
          <p class="text-sm text-muted">Stripe account connected: {{ stripeAccountId }}</p>
          <div class="stripe-ach-setup mt-4">
            <h4 class="subsection-title">Enable ACH Direct Debit</h4>
            <ol class="setup-list">
              <li>In Stripe, click the gear icon.</li>
              <li>Under Product settings, open Payments > Payment methods.</li>
              <li>Select Default if Stripe shows that option.</li>
              <li>If ACH is not visible, scroll through Regional and international payment options.</li>
              <li>Under United States, turn on ACH Direct Debit / US bank account.</li>
              <li>Finish Stripe verification until ACH is active on the account.</li>
              <li>In ScaleSafe, open an offer, enable dual pricing, and allow Bank Transfer / ACH.</li>
            </ol>
            <p class="text-sm text-muted mt-2">
              ScaleSafe uses Stripe's bank-account collection, mandate, and webhook status updates. ACH payments can process for several business days, so each offer controls whether access waits for settlement or is released after submission.
            </p>
            <div class="doc-links">
              <a href="https://docs.stripe.com/payments/ach-direct-debit" target="_blank" rel="noreferrer">Stripe ACH guide</a>
              <a href="https://docs.stripe.com/connect/account-capabilities" target="_blank" rel="noreferrer">ACH capability docs</a>
            </div>
          </div>
          <div v-if="riskAudit" class="mt-2">
            <p class="text-sm">
              Risk Level: <strong :class="'risk-level-' + riskAudit.overallRiskLevel">{{ riskAudit.overallRiskLevel }}</strong>
            </p>
            <p class="text-sm">Dispute Rate Score: {{ riskAudit.scoreDisputeRate }}/100</p>
            <router-link to="/risk-health" class="btn btn-secondary btn-sm mt-2">View Risk &amp; Health Dashboard</router-link>
          </div>
          <button class="btn btn-danger btn-sm mt-2" @click="disconnectStripe">Disconnect</button>
        </div>
      </div>

      <!-- Whop Checkout Channel -->
      <div class="card">
        <div class="flex-between mb-4">
          <div>
            <h3 class="section-title" style="margin-bottom:0">Whop</h3>
            <p class="text-sm text-muted mt-2">Connect Whop so selected offers can use Whop checkout while ScaleSafe still tracks payments, enrollment, and evidence.</p>
          </div>
          <span v-if="whopConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Company ID</label>
            <input class="form-input" v-model="whopForm.companyId" placeholder="Whop company ID" />
          </div>
          <div class="form-group">
            <label class="form-label">Environment</label>
            <select class="form-select" v-model="whopForm.environment">
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Company API Key</label>
          <input class="form-input" v-model="whopForm.apiKey" type="password" :placeholder="whopConnected ? 'Saved. Paste a replacement key only if rotating.' : 'Paste Whop API key'" />
        </div>
        <div class="form-group">
          <label class="form-label">Webhook Secret</label>
          <input class="form-input" v-model="whopForm.webhookSecret" type="password" :placeholder="whopStatus?.hasWebhookSecret ? 'Saved. Paste a replacement secret only if rotating.' : 'Paste Whop webhook secret'" />
        </div>
        <div class="setup-row">
          <label>Webhook URL</label>
          <div class="copy-line">
            <input class="form-input mono" :value="whopStatus?.webhookUrl || 'https://dashboard.scalesafe.app/webhooks/whop'" readonly />
            <button class="btn btn-secondary btn-sm" @click="copyText(whopStatus?.webhookUrl || 'https://dashboard.scalesafe.app/webhooks/whop')">Copy</button>
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" @click="saveWhop" :disabled="whopSaving">{{ whopSaving ? 'Saving...' : 'Save Whop' }}</button>
          <button class="btn btn-secondary" @click="testWhop" :disabled="whopTesting || !whopConnected">{{ whopTesting ? 'Testing...' : 'Test Connection' }}</button>
          <button v-if="whopConnected" class="btn btn-danger btn-sm" @click="disconnectWhop">Disconnect</button>
        </div>
        <p v-if="whopMessage" class="text-sm mt-2" :style="{ color: whopMessageOk ? '#059669' : '#dc2626' }">{{ whopMessage }}</p>
        <p v-if="whopStatus?.lastError" class="text-sm mt-2" style="color:#dc2626">{{ whopStatus.lastError }}</p>
      </div>

      <!-- FanBasis Checkout Channel (Model B) -->
      <div class="card">
        <div class="flex-between mb-4">
          <div>
            <h3 class="section-title" style="margin-bottom:0">FanBasis</h3>
            <p class="text-sm text-muted mt-2">Connect FanBasis so selected offers can use FanBasis checkout (cards, Apple/Google Pay, Cash App, and BNPL where enabled) while ScaleSafe still tracks payments, enrollment, and evidence.</p>
          </div>
          <span v-if="fanbasisConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Creator Handle</label>
            <input class="form-input" v-model="fanbasisForm.creatorHandle" placeholder="FanBasis creator handle" />
          </div>
          <div class="form-group">
            <label class="form-label">Environment</label>
            <select class="form-select" v-model="fanbasisForm.environment">
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
          <input class="form-input" v-model="fanbasisForm.apiKey" type="password" :placeholder="fanbasisConnected ? 'Saved. Paste a replacement key only if rotating.' : 'Paste FanBasis API key'" />
        </div>
        <div class="form-group">
          <label class="form-label">Webhook Secret</label>
          <input class="form-input" v-model="fanbasisForm.webhookSecret" type="password" :placeholder="fanbasisStatus?.hasWebhookSecret ? 'Saved. Paste a replacement secret only if rotating.' : 'Paste FanBasis webhook secret'" />
        </div>
        <div class="setup-row">
          <label>Webhook URL</label>
          <div class="copy-line">
            <input class="form-input mono" :value="fanbasisStatus?.webhookUrl || 'https://dashboard.scalesafe.app/webhooks/fanbasis'" readonly />
            <button class="btn btn-secondary btn-sm" @click="copyText(fanbasisStatus?.webhookUrl || 'https://dashboard.scalesafe.app/webhooks/fanbasis')">Copy</button>
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary" @click="saveFanbasis" :disabled="fanbasisSaving">{{ fanbasisSaving ? 'Saving...' : 'Save FanBasis' }}</button>
          <button v-if="fanbasisConnected" class="btn btn-danger btn-sm" @click="disconnectFanbasis">Disconnect</button>
        </div>
        <p class="text-sm text-muted mt-2">Connection testing will be enabled once the FanBasis sandbox endpoint is confirmed.</p>
        <p v-if="!fanbasisConnected" class="text-sm text-muted mt-2">
          Don't have a FanBasis account?
          <a href="https://www.fanbasis.com" target="_blank" rel="noopener" style="color:var(--ss-primary-700)">Sign up here</a>.
          <!-- TODO(referral): replace with ScaleSafe's FanBasis referral link once confirmed (Decision D4). -->
        </p>
        <p v-if="fanbasisMessage" class="text-sm mt-2" :style="{ color: fanbasisMessageOk ? '#059669' : '#dc2626' }">{{ fanbasisMessage }}</p>
        <p v-if="fanbasisStatus?.lastError" class="text-sm mt-2" style="color:#dc2626">{{ fanbasisStatus.lastError }}</p>
      </div>

      <!-- Dispute prevention: enrollment lives in the Stripe Dashboard (no API) -->
      <div v-if="stripeConnected" class="card">
        <h3 class="section-title">Dispute Prevention (Stripe)</h3>
        <p class="text-sm mb-4">
          Stripe offers programs that <strong>refund a charge before it becomes a chargeback</strong>:
          Rapid Dispute Resolution for Visa and Ethoca Alerts for Mastercard. You set a rule once
          (e.g. auto-resolve anything under a dollar amount you choose) and matching pre-disputes are
          refunded automatically — they never hit your dispute rate and carry no dispute fee.
        </p>
        <p class="text-sm text-muted mb-4">
          Enrollment happens in your Stripe Dashboard — ScaleSafe can't turn it on for you.
          After opening the page below, click <strong>Activate</strong> on each program and set
          your parameters (the auto-refund rules). While you're in the Dashboard, also enable
          dispute notification emails under Settings &gt; Communication preferences so Stripe
          emails you the moment anything arrives. ScaleSafe handles the case-by-case side:
          early fraud warnings appear on the Stripe Risk Health page, where you can refund or
          hold each one.
        </p>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <a href="https://dashboard.stripe.com/settings/disputes" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
            Open Stripe Dispute Prevention
          </a>
          <router-link to="/defense/prevention" class="btn btn-secondary btn-sm">Full Prevention Checklist</router-link>
          <router-link to="/risk-health" class="btn btn-secondary btn-sm">Early Fraud Warnings</router-link>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useApi, ssoSession } from '../composables/useApi';
import SectionHeader from '../components/SectionHeader.vue';

const api = useApi();
const nmiPlanAvailable = computed(() => ssoSession.entitlement.processors.nmi);

const pageLoading = ref(true);
const loadError = ref<string | null>(null);
const nmiConnected = ref(false);
const stripeConnected = ref(false);
const defaultProcessor = ref('');
const stripeAccountId = ref('');
const stripeModeMatches = ref(false);
const nmiProcessorId = ref('');
const nmiConfigs = ref<Array<{
  id: string;
  label: string;
  nmiProcessorId: string;
  hasSecurityKey: boolean;
  hasTokenizationKey: boolean;
  isDefault: boolean;
  webhookStatus: string;
  webhookAdvancedCallbackUrl?: string | null;
  webhookHasKey?: boolean;
  lastVerifiedAt?: string | null;
  createdAt?: string;
}>>([]);
const autoSubmit = ref(false);
const saving = ref(false);
const testing = ref(false);
const nmiTestResult = ref<{ success: boolean; message: string } | null>(null);
const riskAudit = ref<any>(null);
const nmiWebhook = ref<any>(null);
const nmiWebhookLoading = ref(false);
const nmiWebhookSaving = ref(false);
const nmiWebhookMessage = ref('');
const nmiWebhookKeyInput = ref('');
const showNmiWebhookKey = ref(false);
const whopStatus = ref<any>(null);
const whopConnected = ref(false);
const whopSaving = ref(false);
const whopTesting = ref(false);
const whopMessage = ref('');
const whopMessageOk = ref(true);
const whopForm = ref({
  companyId: '',
  apiKey: '',
  webhookSecret: '',
  environment: 'production',
});
const fanbasisStatus = ref<any>(null);
const fanbasisConnected = ref(false);
const fanbasisSaving = ref(false);
const fanbasisMessage = ref('');
const fanbasisMessageOk = ref(true);
const fanbasisForm = ref({
  creatorHandle: '',
  apiKey: '',
  webhookSecret: '',
  environment: 'sandbox',
});
const dualPricingConfig = ref({
  enabled: false,
  locationScoped: false,
  cardUpliftPercent: 0,
  processorDeductionPercent: 0,
  enabledProcessors: [] as string[],
  effectiveAt: null as string | null,
});
const dualPricingForm = ref({
  cardUpliftPercent: '',
});
const dualPricingSaving = ref(false);
const dualPricingMessage = ref('');
const dualPricingMessageOk = ref(true);
const dualPricingDeductionLabel = computed(() => {
  const uplift = Number(dualPricingForm.value.cardUpliftPercent || 0);
  if (!Number.isFinite(uplift) || uplift < 0) return 'Enter a valid rate';
  const deduction = uplift > 0 ? (uplift / (100 + uplift)) * 100 : 0;
  return `${deduction.toFixed(4)}%`;
});
const nmiForm = ref({
  label: '',
  securityKey: '',
  tokenizationKey: '',
  processorId: '',
  isDefault: false,
});

onMounted(async () => {
  await loadProcessorStatus();
});

async function loadProcessorStatus() {
  pageLoading.value = true;
  loadError.value = null;
  try {
    const data = await api.get<any>('/api/merchants/config');
    stripeConnected.value = data.stripeConnected || false;
    stripeAccountId.value = data.stripeUserId || '';
    stripeModeMatches.value = !!data.stripeModeMatches;
    nmiConnected.value = data.nmiConnected || false;
    nmiProcessorId.value = data.nmiProcessorId || '';
    nmiConfigs.value = Array.isArray(data.nmiConfigs)
      ? data.nmiConfigs.map((config: any) => ({
        id: config.id || config.nmiProcessorId || '',
        label: config.label || config.nmiProcessorId || 'NMI Account',
        nmiProcessorId: config.nmiProcessorId || config.id || '',
        hasSecurityKey: true,
        hasTokenizationKey: true,
        isDefault: !!config.isDefault,
        webhookStatus: 'manual_setup_required',
      }))
      : [];
    defaultProcessor.value = data.defaultProcessor || '';
    await loadDualPricing();
    await loadNmiConfigs();

    if (stripeConnected.value) {
      try {
        const audit = await api.get<any>('/api/stripe/risk-audit');
        riskAudit.value = audit;
      } catch {
        // Risk audit may not be available yet
      }
    }
    if (nmiConnected.value) {
      await loadNmiWebhook();
    }
    await loadWhop();
    await loadFanbasis();
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load processor status';
  } finally {
    pageLoading.value = false;
  }
}

async function loadDualPricing() {
  try {
    const cfg = await api.get<any>('/api/offers/dual-pricing/config');
    dualPricingConfig.value = {
      enabled: !!cfg.enabled,
      locationScoped: !!cfg.locationScoped,
      cardUpliftPercent: Number(cfg.cardUpliftPercent || 0),
      processorDeductionPercent: Number(cfg.processorDeductionPercent || 0),
      enabledProcessors: Array.isArray(cfg.enabledProcessors) ? cfg.enabledProcessors : [],
      effectiveAt: cfg.effectiveAt || null,
    };
    dualPricingForm.value.cardUpliftPercent = Number(cfg.cardUpliftPercent || 0).toFixed(2);
  } catch (err: any) {
    dualPricingMessageOk.value = false;
    dualPricingMessage.value = err?.message || 'Failed to load dual pricing rate.';
  }
}

async function saveDualPricing() {
  const cardUpliftPercent = Number(dualPricingForm.value.cardUpliftPercent);
  if (!Number.isFinite(cardUpliftPercent) || cardUpliftPercent < 0 || cardUpliftPercent > 10) {
    dualPricingMessageOk.value = false;
    dualPricingMessage.value = 'Card price uplift must be between 0 and 10%.';
    return;
  }

  dualPricingSaving.value = true;
  dualPricingMessage.value = '';
  try {
    const cfg = await api.put<any>('/api/offers/dual-pricing/config', {
      cardUpliftPercent,
      enabledProcessors: ['stripe', 'nmi'],
    });
    dualPricingConfig.value = {
      enabled: !!cfg.enabled,
      locationScoped: !!cfg.locationScoped,
      cardUpliftPercent: Number(cfg.cardUpliftPercent || 0),
      processorDeductionPercent: Number(cfg.processorDeductionPercent || 0),
      enabledProcessors: Array.isArray(cfg.enabledProcessors) ? cfg.enabledProcessors : [],
      effectiveAt: cfg.effectiveAt || null,
    };
    dualPricingForm.value.cardUpliftPercent = Number(cfg.cardUpliftPercent || 0).toFixed(2);
    dualPricingMessageOk.value = true;
    dualPricingMessage.value = 'Dual pricing rate saved for this merchant.';
  } catch (err: any) {
    dualPricingMessageOk.value = false;
    dualPricingMessage.value = err?.message || 'Failed to save dual pricing rate.';
  } finally {
    dualPricingSaving.value = false;
  }
}

async function connectNmi() {
  if (!nmiForm.value.securityKey || !nmiForm.value.tokenizationKey) {
    loadError.value = 'Security Key and Tokenization Key are required.';
    return;
  }
  saving.value = true;
  loadError.value = null;
  try {
    await api.post('/api/processor-config/nmi', {
      label: nmiForm.value.label || undefined,
      securityKey: nmiForm.value.securityKey,
      tokenizationKey: nmiForm.value.tokenizationKey,
      processorId: nmiForm.value.processorId || undefined,
      isDefault: nmiForm.value.isDefault || !nmiConnected.value,
    });
    nmiConnected.value = true;
    nmiProcessorId.value = nmiForm.value.processorId || '';
    nmiForm.value = { label: '', securityKey: '', tokenizationKey: '', processorId: '', isDefault: false };
    nmiTestResult.value = null;
    await loadNmiConfigs();
    await loadNmiWebhook();
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to connect NMI';
  }
  saving.value = false;
}

async function loadNmiConfigs() {
  try {
    const result = await api.get<{ configs: typeof nmiConfigs.value }>('/api/processor-config/nmi');
    nmiConfigs.value = Array.isArray(result.configs) ? result.configs : [];
    nmiConnected.value = nmiConfigs.value.length > 0;
    nmiProcessorId.value = nmiConfigs.value.find((config) => config.isDefault)?.nmiProcessorId || nmiConfigs.value[0]?.nmiProcessorId || '';
  } catch {
    nmiConfigs.value = [];
    nmiConnected.value = false;
    nmiProcessorId.value = '';
  }
}

async function setDefaultNmiRoute(configId: string) {
  loadError.value = null;
  try {
    await api.post(`/api/processor-config/nmi/${encodeURIComponent(configId)}/default`, {});
    await loadNmiConfigs();
    await loadNmiWebhook();
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to set default NMI route.';
  }
}

async function deactivateNmiRoute(route: { id: string; label: string }) {
  if (!confirm(`Remove NMI route "${route.label}"? Existing payments remain in ScaleSafe, but this route will no longer be selectable for new offers.`)) return;
  loadError.value = null;
  try {
    await api.del(`/api/processor-config/nmi/${encodeURIComponent(route.id)}`);
    await loadNmiConfigs();
    if (nmiConnected.value) await loadNmiWebhook();
    else nmiWebhook.value = null;
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to remove NMI route.';
  }
}

async function loadWhop() {
  try {
    whopStatus.value = await api.get<any>('/api/processor-config/whop');
    whopConnected.value = !!whopStatus.value?.connected;
    whopForm.value.companyId = whopStatus.value?.companyId || '';
    whopForm.value.environment = whopStatus.value?.environment || 'production';
    whopForm.value.apiKey = '';
    whopForm.value.webhookSecret = '';
  } catch {
    whopStatus.value = null;
    whopConnected.value = false;
  }
}

async function saveWhop() {
  if (!whopForm.value.companyId.trim() || (!whopConnected.value && !whopForm.value.apiKey.trim())) {
    loadError.value = 'Whop company ID and API key are required.';
    return;
  }
  whopSaving.value = true;
  whopMessage.value = '';
  loadError.value = null;
  try {
    const payload: Record<string, string> = {
      companyId: whopForm.value.companyId.trim(),
      environment: whopForm.value.environment,
    };
    if (whopForm.value.apiKey.trim()) payload.apiKey = whopForm.value.apiKey.trim();
    if (whopForm.value.webhookSecret.trim()) payload.webhookSecret = whopForm.value.webhookSecret.trim();
    whopStatus.value = await api.post<any>('/api/processor-config/whop', payload);
    whopConnected.value = true;
    whopForm.value.apiKey = '';
    whopForm.value.webhookSecret = '';
    whopMessageOk.value = true;
    whopMessage.value = 'Whop connection saved.';
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to save Whop connection';
  } finally {
    whopSaving.value = false;
  }
}

async function testWhop() {
  whopTesting.value = true;
  whopMessage.value = '';
  try {
    const result = await api.post<{ success: boolean; message: string }>('/api/processor-config/whop/test', {});
    whopMessageOk.value = result.success;
    whopMessage.value = result.message;
    await loadWhop();
  } catch (err: any) {
    whopMessageOk.value = false;
    whopMessage.value = err?.message || 'Whop test failed';
  } finally {
    whopTesting.value = false;
  }
}

async function disconnectWhop() {
  if (!confirm('Disconnect Whop? Whop checkout offers will stop accepting payment until reconnected.')) return;
  try {
    await api.del('/api/processor-config/whop');
    await loadWhop();
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to disconnect Whop';
  }
}

async function loadFanbasis() {
  try {
    fanbasisStatus.value = await api.get<any>('/api/processor-config/fanbasis');
    fanbasisConnected.value = !!fanbasisStatus.value?.connected;
    fanbasisForm.value.creatorHandle = fanbasisStatus.value?.creatorHandle || '';
    fanbasisForm.value.environment = fanbasisStatus.value?.environment || 'sandbox';
    fanbasisForm.value.apiKey = '';
    fanbasisForm.value.webhookSecret = '';
  } catch {
    fanbasisStatus.value = null;
    fanbasisConnected.value = false;
  }
}

async function saveFanbasis() {
  if (!fanbasisConnected.value && !fanbasisForm.value.apiKey.trim()) {
    loadError.value = 'FanBasis API key is required.';
    return;
  }
  fanbasisSaving.value = true;
  fanbasisMessage.value = '';
  try {
    const payload: any = {
      creatorHandle: fanbasisForm.value.creatorHandle.trim(),
      environment: fanbasisForm.value.environment,
    };
    if (fanbasisForm.value.apiKey.trim()) payload.apiKey = fanbasisForm.value.apiKey.trim();
    if (fanbasisForm.value.webhookSecret.trim()) payload.webhookSecret = fanbasisForm.value.webhookSecret.trim();
    fanbasisStatus.value = await api.post<any>('/api/processor-config/fanbasis', payload);
    fanbasisConnected.value = true;
    fanbasisForm.value.apiKey = '';
    fanbasisForm.value.webhookSecret = '';
    fanbasisMessageOk.value = true;
    fanbasisMessage.value = 'FanBasis connection saved.';
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to save FanBasis connection';
  } finally {
    fanbasisSaving.value = false;
  }
}

async function disconnectFanbasis() {
  if (!confirm('Disconnect FanBasis? FanBasis checkout offers will stop accepting payment until reconnected.')) return;
  try {
    await api.del('/api/processor-config/fanbasis');
    await loadFanbasis();
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to disconnect FanBasis';
  }
}

async function loadNmiWebhook() {
  nmiWebhookLoading.value = true;
  nmiWebhookMessage.value = '';
  try {
    nmiWebhook.value = await api.get<any>('/api/processor-config/nmi/webhook');
    nmiWebhookKeyInput.value = '';
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to load NMI webhook setup';
  } finally {
    nmiWebhookLoading.value = false;
  }
}

async function saveNmiWebhookKey() {
  if (!nmiWebhookKeyInput.value.trim()) {
    loadError.value = 'Paste the NMI webhook key first.';
    return;
  }
  nmiWebhookSaving.value = true;
  nmiWebhookMessage.value = '';
  loadError.value = null;
  try {
    nmiWebhook.value = await api.post<any>('/api/processor-config/nmi/webhook/key', {
      key: nmiWebhookKeyInput.value.trim(),
    });
    nmiWebhookKeyInput.value = '';
    nmiWebhookMessage.value = 'NMI webhook key saved.';
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to save NMI webhook key';
  } finally {
    nmiWebhookSaving.value = false;
  }
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value || '');
  nmiWebhookMessage.value = 'Copied.';
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

async function testNmiConnection() {
  if (!nmiForm.value.securityKey || !nmiForm.value.tokenizationKey) {
    nmiTestResult.value = { success: false, message: 'Enter Security Key and Tokenization Key first.' };
    return;
  }
  testing.value = true;
  nmiTestResult.value = null;
  try {
    const result = await api.post<{ success: boolean; message: string }>(
      '/api/processor-config/nmi/test',
      {
        securityKey: nmiForm.value.securityKey,
        tokenizationKey: nmiForm.value.tokenizationKey,
        processorId: nmiForm.value.processorId || undefined,
      },
    );
    nmiTestResult.value = result;
  } catch (err: any) {
    nmiTestResult.value = { success: false, message: err?.message || 'Test failed' };
  }
  testing.value = false;
}

let stripeMessageHandler: ((event: MessageEvent) => void) | null = null;
let stripePopup: Window | null = null;

async function connectStripe() {
  // Cleanup any prior attempt
  if (stripeMessageHandler) {
    window.removeEventListener('message', stripeMessageHandler);
    stripeMessageHandler = null;
  }
  if (stripePopup && !stripePopup.closed) stripePopup.close();

  try {
    // Open Stripe OAuth in a popup - Stripe refuses to load inside an iframe,
    // so the SPA stays inside GHL (preserving SSO) and the popup handles OAuth.
    // The /auth/stripe/callback endpoint renders a page that postMessages the
    // result back here and self-closes.
    const connect = await api.get<{ url: string }>('/auth/stripe/connect-url');
    const url = connect.url;
    stripePopup = window.open(url, 'scalesafe_stripe_oauth', 'width=600,height=750');
    if (!stripePopup) {
      loadError.value = 'Popup blocked. Please allow popups for this site and try again.';
      return;
    }

    stripeMessageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'stripe_connect_result') return;
      window.removeEventListener('message', stripeMessageHandler!);
      stripeMessageHandler = null;
      stripePopup = null;

      if (event.data.success) {
        loadError.value = null;
        loadProcessorStatus();
      } else {
        loadError.value = 'Stripe connection failed: ' + (event.data.error || 'unknown error');
      }
    };
    window.addEventListener('message', stripeMessageHandler);
  } catch (err: any) {
    loadError.value = err.message || 'Failed to initiate Stripe connection';
  }
}

async function disconnectNmi() {
  if (!confirm('Disconnect NMI? Future charges via NMI will not be possible until you reconnect.')) return;
  try {
    await api.del('/api/processor-config/nmi');
    nmiConnected.value = false;
    nmiProcessorId.value = '';
    nmiConfigs.value = [];
    nmiWebhook.value = null;
    if (defaultProcessor.value === 'nmi') defaultProcessor.value = '';
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to disconnect NMI';
  }
}

async function disconnectStripe() {
  if (!confirm('Disconnect Stripe? Defense monitoring will stop.')) return;
  try {
    await api.post('/api/stripe/disconnect');
    stripeConnected.value = false;
    stripeAccountId.value = '';
    stripeModeMatches.value = false;
    riskAudit.value = null;
  } catch (err: any) {
    loadError.value = err.message || 'Failed to disconnect Stripe';
  }
}

async function setDefaultProcessor(processor: string) {
  const previous = defaultProcessor.value;
  defaultProcessor.value = processor;
  loadError.value = null;
  try {
    await api.post('/api/processor-config/default', { processor });
  } catch (err: any) {
    defaultProcessor.value = previous;
    loadError.value = err?.message || 'Failed to set default processor';
  }
}

async function saveAutoSubmit() {
  // TODO: Endpoint /api/merchant/settings not yet built
}
</script>

<style scoped>
.section-title {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.subsection-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.webhook-panel {
  border-top: 1px solid #e5e7eb;
  padding-top: 16px;
}

.nmi-route-list {
  display: grid;
  gap: 10px;
}

.nmi-route-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
}

.route-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #0f172a;
}

.route-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #334155;
}

.stripe-ach-setup {
  border: 1px solid #dbeafe;
  background: #f8fafc;
  border-radius: 8px;
  padding: 14px 16px;
}

.setup-list {
  margin: 10px 0 0;
  padding-left: 20px;
  color: #334155;
  font-size: 13px;
  line-height: 1.55;
}

.doc-links {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 13px;
}

.doc-links a {
  color: var(--ss-primary-700);
  font-weight: 600;
}

.setup-row {
  margin-bottom: 12px;
}

.setup-row label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.copy-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.copy-line .form-input {
  min-width: 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.event-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.event-pill {
  display: inline-flex;
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 12px;
  color: #334155;
  background: #f8fafc;
}

.settings-stub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}

.toggle-switch-label {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.toggle-container {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.toggle-container input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-track {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: #d1d5db;
  transition: 0.2s;
}

.toggle-track.active {
  background: var(--ss-primary-500);
}

.toggle-thumb {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  top: 3px;
  left: 4px;
  transition: 0.2s;
}

.toggle-thumb.active {
  left: 26px;
}

.risk-level-safe { color: #059669; }
.risk-level-moderate { color: #d97706; }
.risk-level-elevated { color: #ea580c; }
.risk-level-high { color: #dc2626; }
.risk-level-critical { color: #991b1b; }
</style>
