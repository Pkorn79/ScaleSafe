<template>
  <div class="settings-payments">
    <h1 class="page-title">Payment Processing</h1>
    <p class="text-sm text-muted mb-4">Connect your payment processor to enable checkout through ScaleSafe.</p>

    <div v-if="loadError" class="error-msg">{{ loadError }}</div>
    <div v-if="pageLoading" class="loading">Loading processor status...</div>

    <template v-if="!pageLoading">
      <!-- Default Processor Toggle (only show if both connected) -->
      <div v-if="nmiConnected && stripeConnected" class="card mb-4">
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
      <div class="card mb-4">
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
          <button class="btn btn-danger btn-sm mt-2" @click="disconnectNmi">Disconnect</button>
        </div>
      </div>

      <!-- Stripe Connection -->
      <div class="card mb-4">
        <div class="flex-between mb-4">
          <h3 class="section-title" style="margin-bottom:0">Stripe</h3>
          <span v-if="stripeConnected" class="badge badge-green">Connected</span>
          <span v-else class="badge badge-gray">Not Connected</span>
        </div>

        <div v-if="!stripeConnected">
          <p class="text-sm text-muted mb-4">Connect your existing Stripe account to enable payment processing and dispute defense.</p>
          <p class="text-sm mb-4" style="color:#3b82f6">Connecting Stripe gives you instant access to your risk profile and defense tools.</p>
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
      <div v-if="stripeConnected" class="card mb-4">
        <h3 class="section-title">Dispute Auto-Submit</h3>
        <p class="text-sm text-muted mb-4">When enabled, ScaleSafe automatically submits evidence for disputes with strong evidence (score 60+). Disable to review each packet before submission.</p>
        <label class="toggle-switch-label">
          <span class="toggle-container">
            <input type="checkbox" v-model="autoSubmit" @change="saveAutoSubmit" />
            <span class="toggle-track" :class="{ active: autoSubmit }">
              <span class="toggle-thumb" :class="{ active: autoSubmit }"></span>
            </span>
          </span>
          <span class="text-sm">{{ autoSubmit ? 'Auto-submit enabled' : 'Manual review mode' }}</span>
        </label>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi, ssoSession } from '../composables/useApi';

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

const nmiForm = ref({
  securityKey: '',
  tokenizationKey: '',
  processorId: '',
});

onMounted(async () => {
  await loadProcessorStatus();

  // Check for Stripe callback result in URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('stripe_connected') === 'true') {
    stripeConnected.value = true;
    loadError.value = null;
    window.history.replaceState({}, '', window.location.pathname);
  } else if (urlParams.get('stripe_error')) {
    loadError.value = 'Stripe connection failed: ' + (urlParams.get('stripe_error') || 'unknown error');
    window.history.replaceState({}, '', window.location.pathname);
  }
});

async function loadProcessorStatus() {
  pageLoading.value = true;
  loadError.value = null;
  try {
    const data = await api.get<any>('/api/merchants/config');
    stripeConnected.value = data.stripeConnected || false;
    stripeAccountId.value = data.stripeUserId || '';
    defaultProcessor.value = data.defaultProcessor || '';
    nmiConnected.value = false; // TODO: NMI status from config when NMI support is added

    if (stripeConnected.value) {
      try {
        const audit = await api.get<any>(`/api/stripe/risk-audit/${ssoSession.locationId}`);
        riskAudit.value = audit;
      } catch {
        // Risk audit may not be available yet
      }
    }
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load processor status';
  } finally {
    pageLoading.value = false;
  }
}

async function connectNmi() {
  // TODO: NMI processor config endpoints not yet built
  loadError.value = 'NMI connection is not yet available. Use Stripe for now.';
}

async function testNmiConnection() {
  // TODO: NMI connection test endpoint not yet built
  loadError.value = 'NMI connection test is not yet available.';
}

async function connectStripe() {
  try {
    const config = await api.get<any>('/api/merchants/config');
    const locationId = config?.locationId;
    if (!locationId) {
      loadError.value = 'Location ID not found. Please refresh and try again.';
      return;
    }
    // Navigate to Stripe OAuth — this is a redirect, not an AJAX call
    window.location.href = '/auth/stripe/connect?locationId=' + encodeURIComponent(locationId);
  } catch (err: any) {
    loadError.value = err.message || 'Failed to initiate Stripe connection';
  }
}

async function disconnectNmi() {
  // TODO: NMI disconnect endpoint not yet built
  loadError.value = 'NMI disconnect is not yet available.';
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
  defaultProcessor.value = processor;
  // TODO: Endpoint /api/processor-config/default not yet built
  loadError.value = 'Default processor selection will be available soon.';
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
  background: #3b82f6;
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
