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
      <!-- Default Processor Toggle (only show if both connected) -->
      <div v-if="nmiConnected && stripeConnected" class="card">
        <h3 class="section-title">Default Processor</h3>
        <p class="text-sm text-muted mb-4">Choose which processor handles new payments by default. You can override this per offer.</p>
        <div class="flex gap-2">
          <button
            class="btn"
            :class="defaultProcessor === 'nmi' ? 'btn-primary' : 'btn-secondary'"
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

      <!-- NMI Connection -->
      <div class="card">
        <div class="flex-between mb-4">
          <h3 class="section-title" style="margin-bottom:0">NMI</h3>
          <span v-if="nmiConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div v-if="!nmiConnected">
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
            <label class="form-label">Processor ID (optional)</label>
            <input
              class="form-input"
              v-model="nmiForm.processorId"
              type="text"
              placeholder="For multi-MID routing"
            />
            <p class="text-sm text-muted mt-2">Only needed if you have multiple merchant accounts in NMI</p>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" @click="connectNmi" :disabled="saving">
              {{ saving ? 'Connecting...' : 'Connect NMI' }}
            </button>
            <button class="btn btn-secondary" @click="testNmiConnection" :disabled="testing">
              {{ testing ? 'Testing...' : 'Test Connection' }}
            </button>
          </div>
          <div v-if="nmiTestResult" class="mt-2 text-sm" :style="{ color: nmiTestResult.success ? '#059669' : '#dc2626' }">
            {{ nmiTestResult.message }}
          </div>
        </div>

        <div v-else>
          <p class="text-sm text-muted">NMI account connected. Security key stored securely.</p>
          <p v-if="nmiProcessorId" class="text-sm text-muted">Processor ID: {{ nmiProcessorId }}</p>
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
                  Use the key shown in NMI Webhooks. ScaleSafe uses it to verify the Signature header on official events.
                </p>
              </div>
              <div class="setup-row">
                <label>Required events</label>
                <div class="event-list">
                  <span v-for="event in nmiWebhook.events" :key="event" class="event-pill">{{ event }}</span>
                </div>
              </div>
              <p class="text-sm text-muted">Signature header: <span class="mono">Signature</span></p>
              <p v-if="nmiWebhook.lastVerifiedAt" class="text-sm text-muted">Last verified: {{ formatDateTime(nmiWebhook.lastVerifiedAt) }}</p>
              <p v-if="nmiWebhook.lastError" class="text-sm" style="color:#dc2626">{{ nmiWebhook.lastError }}</p>
              <div class="flex gap-2 mt-2">
                <button class="btn btn-secondary btn-sm" @click="loadNmiWebhook">Refresh</button>
              </div>
              <p v-if="nmiWebhookMessage" class="text-sm mt-2" style="color:#059669">{{ nmiWebhookMessage }}</p>
            </template>
            <p v-else class="text-sm text-muted">Webhook setup values are not available yet.</p>
          </div>
          <button class="btn btn-danger btn-sm mt-2" @click="disconnectNmi">Disconnect</button>
        </div>
      </div>

      <!-- Stripe Connection -->
      <div class="card">
        <div class="flex-between mb-4">
          <h3 class="section-title" style="margin-bottom:0">Stripe</h3>
          <span v-if="stripeConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div v-if="!stripeConnected">
          <p class="text-sm text-muted mb-4">Connect your existing Stripe account to enable payment processing and dispute defense.</p>
          <p class="text-sm mb-4" style="color: var(--ss-primary-700)">Connecting Stripe gives you instant access to your risk profile and defense tools.</p>
          <button class="btn btn-primary" @click="connectStripe">
            Connect with Stripe
          </button>
        </div>

        <div v-else>
          <p class="text-sm text-muted">Stripe account connected: {{ stripeAccountId }}</p>
          <div v-if="riskAudit" class="mt-2">
            <p class="text-sm">
              Risk Level: <strong :class="'risk-level-' + riskAudit.overallRiskLevel">{{ riskAudit.overallRiskLevel }}</strong>
            </p>
            <p class="text-sm">Dispute Rate Score: {{ riskAudit.scoreDisputeRate }}/100</p>
            <router-link to="/defense/dashboard" class="btn btn-secondary btn-sm mt-2">View Defense Dashboard</router-link>
          </div>
          <button class="btn btn-danger btn-sm mt-2" @click="disconnectStripe">Disconnect</button>
        </div>
      </div>

      <!-- Auto-Submit Toggle -->
      <div v-if="stripeConnected" class="card">
        <h3 class="section-title">Dispute Auto-Submit</h3>
        <p class="text-sm text-muted mb-4">When enabled, ScaleSafe automatically submits evidence for disputes with strong evidence (score 60+). Disable to review each packet before submission.</p>
        <label class="toggle-switch-label">
          <span class="toggle-container">
            <input type="checkbox" v-model="autoSubmit" @change="saveAutoSubmit" />
            <span class="toggle-track" :class="{ active: autoSubmit }">
              <span class="toggle-thumb" :class="{ active: autoSubmit }"></span>
            </span>
          </span>
          <span class="text-sm">{{ autoSubmit ? 'Auto-submit enabled — strong evidence packets are submitted automatically' : 'Auto-submit disabled — review every packet before submission' }}</span>
        </label>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi, ssoSession } from '../composables/useApi';
import SectionHeader from '../components/SectionHeader.vue';

const api = useApi();

const pageLoading = ref(true);
const loadError = ref<string | null>(null);
const nmiConnected = ref(false);
const stripeConnected = ref(false);
const defaultProcessor = ref('');
const stripeAccountId = ref('');
const nmiProcessorId = ref('');
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

const nmiForm = ref({
  securityKey: '',
  tokenizationKey: '',
  processorId: '',
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
    nmiConnected.value = data.nmiConnected || false;
    nmiProcessorId.value = data.nmiProcessorId || '';
    defaultProcessor.value = data.defaultProcessor || '';

    if (stripeConnected.value) {
      try {
        const audit = await api.get<any>(`/api/stripe/risk-audit/${ssoSession.locationId}`);
        riskAudit.value = audit;
      } catch {
        // Risk audit may not be available yet
      }
    }
    if (nmiConnected.value) {
      await loadNmiWebhook();
    }
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load processor status';
  } finally {
    pageLoading.value = false;
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
      securityKey: nmiForm.value.securityKey,
      tokenizationKey: nmiForm.value.tokenizationKey,
      processorId: nmiForm.value.processorId || undefined,
    });
    nmiConnected.value = true;
    nmiProcessorId.value = nmiForm.value.processorId || '';
    nmiForm.value = { securityKey: '', tokenizationKey: '', processorId: '' };
    nmiTestResult.value = null;
    await loadNmiWebhook();
  } catch (err: any) {
    loadError.value = err?.message || 'Failed to connect NMI';
  }
  saving.value = false;
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
    // Open Stripe OAuth in a popup — Stripe refuses to load inside an iframe,
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
