<template>
  <div>
    <SectionHeader
      eyebrow="Settings"
      :title="['Merchant', 'setup.']"
      description="Business information, T&amp;C clauses, and module toggles for this location."
    />

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="saved" class="success-msg">Settings saved successfully.</div>
    <div v-if="loading" class="loading">Loading settings...</div>

    <div v-if="config">
      <!-- Onboarding Status Banner -->
      <div v-if="!config.onboardingComplete" class="onboarding-banner">
        Complete your business setup below to start creating offers. Fields marked * are required.
      </div>

      <!-- Business Information -->
      <div class="card">
        <h3 class="section-title">Business Information</h3>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Business Legal Name *</label>
            <input class="form-input" v-model="config.businessName" placeholder="Your business legal name" />
          </div>
          <div class="form-group">
            <label class="form-label">DBA / Brand Name</label>
            <input class="form-input" v-model="config.dbaName" placeholder="Brand name (if different)" />
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Support Email *</label>
            <input class="form-input" type="email" v-model="config.supportEmail" placeholder="support@yourbusiness.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Payment Descriptor</label>
            <input class="form-input" v-model="config.descriptor" placeholder="Shows on client bank statements" />
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Business Website</label>
            <input class="form-input" v-model="config.businessWebsite" placeholder="yourbusiness.com" />
          </div>
          <div class="form-group">
            <label class="form-label">Merchant Logo</label>
            <div class="logo-upload-area">
              <img v-if="config.logoUrl" :src="config.logoUrl" alt="Logo preview" class="logo-preview" />
              <div class="logo-actions">
                <input type="file" ref="logoFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" @change="handleLogoUpload" style="display:none" />
                <button type="button" class="btn btn-secondary btn-sm" @click="($refs.logoFileInput as HTMLInputElement).click()" :disabled="logoUploading">
                  {{ logoUploading ? 'Uploading...' : (config.logoUrl ? 'Change Logo' : 'Upload Logo') }}
                </button>
                <button v-if="!showLogoUrlInput" type="button" class="btn-link text-sm" @click="showLogoUrlInput = true">or paste URL</button>
              </div>
              <input v-if="showLogoUrlInput" class="form-input mt-2" v-model="config.logoUrl" placeholder="https://yourdomain.com/logo.png" style="font-size:12px" />
            </div>
          </div>
        </div>
        <div class="grid grid-3">
          <div class="form-group">
            <label class="form-label">Business City</label>
            <input class="form-input" v-model="config.businessCity" />
          </div>
          <div class="form-group">
            <label class="form-label">Business State</label>
            <input class="form-input" v-model="config.businessState" placeholder="e.g., CA" />
          </div>
          <div class="form-group">
            <label class="form-label">Industry / Niche</label>
            <input class="form-input" v-model="config.industryNiche" placeholder="e.g., Coaching, Consulting" />
          </div>
        </div>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Primary Service Type</label>
            <select class="form-select" v-model="config.primaryServiceType">
              <option value="">Select...</option>
              <option value="Coaching">Coaching</option>
              <option value="Consulting">Consulting</option>
              <option value="Online Course">Online Course</option>
              <option value="Group Program">Group Program</option>
              <option value="Membership">Membership</option>
              <option value="Agency Services">Agency Services</option>
              <option value="Professional Services">Professional Services</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Short Business Description</label>
            <input class="form-input" v-model="config.shortDescription" placeholder="One-line description of what you offer" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Enrollment Funnel URL *</label>
          <input class="form-input" v-model="config.enrollmentFunnelUrl" placeholder="https://yourdomain.com" />
          <p class="text-sm text-muted mt-2">
            Your GHL funnel domain. Found in GHL &gt; Sites &gt; Funnels &gt; your enrollment funnel URL.
            Enrollment links will use this domain + /welcome path.
          </p>
        </div>

        <div class="text-sm text-muted mt-2">
          Location ID: {{ config.locationId }}
          &nbsp;&middot;&nbsp;Status: <span class="badge badge-green">{{ config.status }}</span>
          &nbsp;&middot;&nbsp;Snapshot: <span class="badge" :class="config.snapshotStatus === 'installed' ? 'badge-green' : config.snapshotStatus === 'failed' ? 'badge-red' : 'badge-yellow'">{{ config.snapshotStatus }}</span>
          <span v-if="config.snapshotError" class="text-sm text-danger" style="margin-left:8px">{{ config.snapshotError }}</span>
          <button v-if="config.snapshotStatus !== 'installed'" class="btn btn-sm btn-secondary" style="margin-left:8px" @click="retryProvision" :disabled="provisionRetrying">
            {{ provisionRetrying ? 'Retrying...' : 'Retry Setup' }}
          </button>
        </div>
      </div>

      <!-- Payment Processor -->
      <div class="card">
        <h3 class="section-title">Payment Processor</h3>

        <div v-if="stripeConnected" class="processor-status connected">
          <div class="status-row">
            <span class="status-dot green"></span>
            <span class="status-text">Stripe Connected</span>
          </div>
          <div class="status-details">
            <span class="text-sm text-muted">Account: {{ stripeAccountId }}</span>
          </div>
          <button class="btn btn-secondary btn-sm mt-2" @click="disconnectStripe" :disabled="stripeDisconnecting">
            {{ stripeDisconnecting ? 'Disconnecting...' : 'Disconnect Stripe' }}
          </button>
        </div>

        <div v-else class="processor-status">
          <p class="text-sm text-muted mb-4">
            Connect your Stripe account to accept payments through the enrollment funnel.
            ScaleSafe uses Stripe Connect so payments go directly to your Stripe account.
          </p>
          <button class="btn btn-primary" @click="connectStripe" :disabled="stripeConnecting">
            {{ stripeConnecting ? 'Redirecting...' : 'Connect Stripe Account' }}
          </button>
        </div>

        <div v-if="stripeError" class="error-msg mt-2">{{ stripeError }}</div>
        <div v-if="stripeSuccess" class="success-msg mt-2">Stripe account connected successfully!</div>

        <!-- NMI Connection Status -->
        <div v-if="nmiConnected" class="processor-status connected mt-4" style="border-top:1px solid #e5e7eb;padding-top:14px">
          <div class="status-row">
            <span class="status-dot green"></span>
            <span class="status-text">NMI Connected</span>
          </div>
          <div class="status-details">
            <span class="text-sm text-muted">Configured via Settings > Processors</span>
          </div>
        </div>

        <!-- Default Processor Selector (when both connected) -->
        <div v-if="stripeConnected && nmiConnected" class="mt-4" style="border-top:1px solid #e5e7eb;padding-top:14px">
          <label class="form-label">Default Processor</label>
          <div class="text-sm text-muted mb-2">Used for offers without a specific processor override.</div>
          <select class="form-select" :value="defaultProcessor" @change="setDefaultProcessor(($event.target as HTMLSelectElement).value)" style="width:200px">
            <option value="nmi">NMI</option>
            <option value="stripe">Stripe</option>
          </select>
          <div v-if="defaultProcessorSaved" class="text-sm mt-1" style="color:#10b981">Default processor updated.</div>
        </div>
      </div>

      <!-- Evidence Module Toggles -->
      <div class="card">
        <h3 class="section-title">Evidence Modules</h3>
        <p class="text-sm text-muted mb-4">
          Enable or disable the evidence tracking modules for your account.
        </p>
        <div v-for="(label, key) in moduleLabels" :key="key" class="flex-between mb-4">
          <span class="text-sm">{{ label }}</span>
          <label class="toggle-switch">
            <input type="checkbox" v-model="config.modules[key]" />
            <span class="toggle-track" :class="{ active: config.modules[key] }">
              <span class="toggle-thumb" :class="{ active: config.modules[key] }"></span>
            </span>
          </label>
        </div>
      </div>

      <!-- Engagement Tracking -->
      <div class="card" v-if="config">
        <h3 class="section-title">Engagement Tracking</h3>
        <p class="text-sm text-muted mb-4">
          When enabled, ScaleSafe scores each client's engagement risk and writes "At Risk" or "Active" to the
          <code>SS Engagement Status</code> contact field. The <strong>SS - Client Re-Engage</strong> and
          <strong>SS - Re-Engagement Outreach</strong> workflows fire from those changes. Turn this off if you
          don't want re-engagement automations running for this account.
        </p>
        <div class="flex-between mb-4">
          <div>
            <span class="text-sm" style="font-weight:500">Enable engagement tracking</span>
            <div class="text-sm text-muted">When off, the app skips all engagement-status writes and the workflows never fire.</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="config.engagementEnabled" />
            <span class="toggle-track" :class="{ active: config.engagementEnabled }">
              <span class="toggle-thumb" :class="{ active: config.engagementEnabled }"></span>
            </span>
          </label>
        </div>
        <div v-if="!config.engagementEnabled" class="text-sm text-muted" style="background:#fef2f2;padding:8px 12px;border-radius:6px;color:#991b1b">
          Engagement tracking is disabled. Existing engagement-status values are not cleared, but no new "At Risk" or "Active" writes will fire.
        </div>
      </div>

      <!-- Dunning & Retry Settings -->
      <div class="card" v-if="config">
        <h3 class="section-title">Dunning & Payment Retry</h3>
        <p class="text-sm text-muted mb-4">
          When a recurring payment fails, ScaleSafe can automatically retry the charge. Configure the behavior below.
        </p>
        <div class="flex-between mb-4">
          <div>
            <span class="text-sm" style="font-weight:500">Enable automatic payment retry</span>
            <div class="text-sm text-muted">When enabled, failed recurring payments are automatically retried on a schedule.</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="config.dunningEnabled" />
            <span class="toggle-track" :class="{ active: config.dunningEnabled }">
              <span class="toggle-thumb" :class="{ active: config.dunningEnabled }"></span>
            </span>
          </label>
        </div>
        <div v-if="config.dunningEnabled" class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Max Retry Attempts</label>
            <select class="form-select" v-model.number="config.dunningMaxRetries">
              <option :value="2">2 retries</option>
              <option :value="3">3 retries (recommended)</option>
              <option :value="5">5 retries</option>
            </select>
          </div>
          <div style="padding-top:24px">
            <div class="text-sm text-muted">
              <strong>Retry schedule:</strong> Soft declines (insufficient funds) are retried at 3, 7, and 14 day intervals.
              Hard declines (expired/invalid card) trigger merchant notification — no automatic retry.
            </div>
          </div>
        </div>
        <div v-if="!config.dunningEnabled" class="text-sm text-muted" style="background:#fef2f2;padding:8px 12px;border-radius:6px;color:#991b1b">
          Dunning is disabled. Failed recurring payments will not be retried automatically. You will need to handle payment failures manually.
        </div>
      </div>

      <!-- Workflow Webhook Secret -->
      <div class="card">
        <h3 class="section-title">Workflow Webhooks</h3>
        <p class="text-sm text-muted mb-4">
          Snapshot workflows should include this header once. New locations receive their own value automatically through the GHL custom value below.
        </p>
        <div class="form-group">
          <label class="form-label">Header Name</label>
          <input class="form-input" :value="webhookHeaderName" readonly />
        </div>
        <div class="form-group">
          <label class="form-label">Header Value for Snapshot Workflows</label>
          <input class="form-input" :value="webhookMergeField" readonly />
          <div class="text-sm text-muted mt-2">
            Use this merge field in GHL workflow Custom Webhook headers so each merchant's secret is inserted automatically.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Raw Secret</label>
          <div class="flex gap-2">
            <input class="form-input" :type="showWebhookSecret ? 'text' : 'password'" :value="webhookSecret || 'Loading...'" readonly />
            <button class="btn btn-secondary" @click="showWebhookSecret = !showWebhookSecret">
              {{ showWebhookSecret ? 'Hide' : 'Show' }}
            </button>
            <button class="btn btn-secondary" @click="copyWebhookSecret" :disabled="!webhookSecret">
              Copy
            </button>
          </div>
          <div class="text-sm text-muted mt-2">
            Enforcement is currently {{ webhookEnforced ? 'on' : 'in observe mode' }}.
          </div>
          <div v-if="webhookSecretSaved" class="success-msg mt-2">{{ webhookSecretSaved }}</div>
          <div v-if="webhookSecretError" class="error-msg mt-2">{{ webhookSecretError }}</div>
        </div>
        <button class="btn btn-secondary" style="color:#ef4444" @click="rotateWebhookSecret" :disabled="webhookSecretLoading">
          {{ webhookSecretLoading ? 'Working...' : 'Rotate Secret' }}
        </button>
      </div>

      <!-- Provisioning Health -->
      <div class="card">
        <div class="flex-between mb-4">
          <h3 class="section-title" style="margin-bottom:0">Provisioning Health</h3>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" @click="repairWebhookSecretCustomValue" :disabled="provisioningHealthLoading">
              {{ provisioningHealthLoading ? 'Working...' : 'Repair Webhook Secret' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="loadProvisioningHealth" :disabled="provisioningHealthLoading">
              {{ provisioningHealthLoading ? 'Checking...' : 'Run Check' }}
            </button>
          </div>
        </div>
        <div v-if="provisioningHealth" class="health-summary" :class="`health-${provisioningHealth.overallStatus}`">
          <span class="status-dot" :class="provisioningHealth.overallStatus === 'pass' ? 'green' : provisioningHealth.overallStatus === 'fail' ? 'red' : 'yellow'"></span>
          <span>{{ healthStatusLabel(provisioningHealth.overallStatus) }}</span>
          <span class="text-sm text-muted">Checked {{ formatCheckedAt(provisioningHealth.checkedAt) }}</span>
        </div>
        <div v-if="provisioningHealthError" class="error-msg mt-2">{{ provisioningHealthError }}</div>
        <div v-if="provisioningHealth" class="health-list">
          <div v-for="item in provisioningHealth.items" :key="item.key" class="health-row">
            <span class="status-dot" :class="item.status === 'pass' ? 'green' : item.status === 'fail' ? 'red' : 'yellow'"></span>
            <div>
              <div class="health-label">{{ item.label }}</div>
              <div class="text-sm text-muted">{{ item.message }}</div>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-muted">
          Run this after a fresh sandbox install to verify the app, Snapshot, GHL fields, custom values, processor setup, and webhook secret are wired correctly.
        </div>
      </div>

      <!-- Disengagement Thresholds -->
      <div class="card">
        <h3 class="section-title">Disengagement Thresholds</h3>
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Consecutive No-Shows to Flag</label>
            <input class="form-input" type="number" v-model.number="thresholds.missedSessionsToFlag" />
          </div>
          <div class="form-group">
            <label class="form-label">Days Inactive (Modules)</label>
            <input class="form-input" type="number" v-model.number="thresholds.inactiveDaysModules" />
          </div>
          <div class="form-group">
            <label class="form-label">Days Inactive (Logins)</label>
            <input class="form-input" type="number" v-model.number="thresholds.inactiveDaysLogin" />
          </div>
          <div class="form-group">
            <label class="form-label">Pulse Score Threshold (flag below)</label>
            <input class="form-input" type="number" v-model.number="thresholds.pulseScoreThreshold" />
          </div>
        </div>
      </div>

      <!-- Admin Actions -->
      <div class="card">
        <h3 class="section-title">Admin Actions</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-secondary" @click="runReconciliation" :disabled="!!running">
            {{ running === 'recon' ? 'Running...' : 'Run Reconciliation' }}
          </button>
          <button class="btn btn-secondary" @click="runDisengagement" :disabled="!!running">
            {{ running === 'disengage' ? 'Running...' : 'Run Disengagement Check' }}
          </button>
          <button class="btn btn-secondary" @click="cleanupKeys" :disabled="!!running">
            {{ running === 'cleanup' ? 'Running...' : 'Cleanup Old Keys' }}
          </button>
        </div>
        <div v-if="adminResult" class="mt-2 text-sm text-muted">{{ adminResult }}</div>
      </div>

      <div class="mt-4">
        <button class="btn btn-primary" @click="saveSettings" :disabled="saving">
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>
    </div>

    <StickySaveBar
      v-if="config"
      :dirty="true"
      :loading="saving"
      save-label="Save Settings"
      @save="saveSettings"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import StickySaveBar from '../components/StickySaveBar.vue';
import SectionHeader from '../components/SectionHeader.vue';

const api = useApi();
const { loading, error } = api;

const config = ref<any>(null);
const thresholds = ref({
  missedSessionsToFlag: 2,
  inactiveDaysModules: 14,
  inactiveDaysLogin: 14,
  pulseScoreThreshold: 2,
});
const saving = ref(false);
const saved = ref(false);
const running = ref<string | false>(false);
const adminResult = ref('');
const provisionRetrying = ref(false);
const logoUploading = ref(false);
const showLogoUrlInput = ref(false);
const logoFileInput = ref<HTMLInputElement | null>(null);
const stripeConnected = ref(false);
const stripeAccountId = ref('');
const stripeConnecting = ref(false);
const stripeDisconnecting = ref(false);
const stripeError = ref('');
const stripeSuccess = ref(false);
const nmiConnected = ref(false);
const defaultProcessor = ref('');
const defaultProcessorSaved = ref(false);
const webhookSecret = ref('');
const webhookHeaderName = ref('x-scalesafe-webhook-secret');
const webhookMergeField = ref('{{ custom_values.scalesafe_webhook_secret }}');
const webhookEnforced = ref(false);
const webhookSecretLoading = ref(false);
const showWebhookSecret = ref(false);
const webhookSecretSaved = ref('');
const webhookSecretError = ref('');
const provisioningHealth = ref<any>(null);
const provisioningHealthLoading = ref(false);
const provisioningHealthError = ref('');

const moduleLabels: Record<string, string> = {
  sessions: 'Session Delivery Tracking',
  milestones: 'Milestone Tracking',
  pulse: 'Pulse Check-Ins',
  payments: 'Payment Tracking',
  course: 'Course/Module Tracking',
};

onMounted(async () => {
  try {
    config.value = await api.get<any>('/api/merchants/config');
    loadWebhookSecret();
    loadProvisioningHealth();
    if (config.value.config?.disengagement_thresholds) {
      Object.assign(thresholds.value, config.value.config.disengagement_thresholds);
    }

    // Check processor connection status
    if (config.value.stripeConnected) {
      stripeConnected.value = true;
      stripeAccountId.value = config.value.stripeUserId || '';
    }
    if (config.value.nmiConnected) {
      nmiConnected.value = true;
    }
    defaultProcessor.value = config.value.defaultProcessor || '';

    // Auto-retry provisioning if failed or pending
    if (config.value && (config.value.snapshotStatus === 'failed' || config.value.snapshotStatus === 'pending' || config.value.snapshotStatus === 'partial')) {
      retryProvision();
    }
  } catch {}
});

async function loadWebhookSecret() {
  webhookSecretLoading.value = true;
  webhookSecretError.value = '';
  try {
    const result = await api.get<any>('/api/merchants/webhook-secret');
    webhookSecret.value = result.secret || '';
    webhookHeaderName.value = result.headerName || 'x-scalesafe-webhook-secret';
    webhookMergeField.value = result.mergeField || '{{ custom_values.scalesafe_webhook_secret }}';
    webhookEnforced.value = !!result.enforceRequired;
  } catch (err: any) {
    webhookSecretError.value = err.message || 'Failed to load webhook secret';
  }
  webhookSecretLoading.value = false;
}

async function copyWebhookSecret() {
  webhookSecretSaved.value = '';
  webhookSecretError.value = '';
  try {
    await navigator.clipboard.writeText(webhookSecret.value);
    webhookSecretSaved.value = 'Webhook secret copied.';
    setTimeout(() => { webhookSecretSaved.value = ''; }, 3000);
  } catch {
    webhookSecretError.value = 'Failed to copy webhook secret.';
  }
}

async function rotateWebhookSecret() {
  if (!confirm('Rotate this webhook secret? Existing GHL workflow webhook headers must be updated after rotation.')) return;
  webhookSecretLoading.value = true;
  webhookSecretSaved.value = '';
  webhookSecretError.value = '';
  try {
    const result = await api.post<any>('/api/merchants/webhook-secret/rotate');
    webhookSecret.value = result.secret || '';
    webhookHeaderName.value = result.headerName || 'x-scalesafe-webhook-secret';
    webhookMergeField.value = result.mergeField || '{{ custom_values.scalesafe_webhook_secret }}';
    webhookEnforced.value = !!result.enforceRequired;
    showWebhookSecret.value = true;
    webhookSecretSaved.value = 'Webhook secret rotated and synced to the GHL custom value. Snapshot workflows using the merge field do not need manual edits.';
  } catch (err: any) {
    webhookSecretError.value = err.message || 'Failed to rotate webhook secret';
  }
  webhookSecretLoading.value = false;
}

async function loadProvisioningHealth() {
  provisioningHealthLoading.value = true;
  provisioningHealthError.value = '';
  try {
    provisioningHealth.value = await api.get<any>('/api/merchants/provisioning-health');
  } catch (err: any) {
    provisioningHealthError.value = err.message || 'Failed to load provisioning health';
  }
  provisioningHealthLoading.value = false;
}

async function repairWebhookSecretCustomValue() {
  provisioningHealthLoading.value = true;
  provisioningHealthError.value = '';
  try {
    provisioningHealth.value = await api.post<any>('/api/merchants/provisioning-health/repair-webhook-secret');
    await loadWebhookSecret();
  } catch (err: any) {
    provisioningHealthError.value = err.message || 'Failed to repair webhook secret custom value';
  }
  provisioningHealthLoading.value = false;
}

function healthStatusLabel(status: string) {
  if (status === 'pass') return 'Install health looks good';
  if (status === 'fail') return 'Install needs attention';
  return 'Install has warnings';
}

function formatCheckedAt(value: string) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function handleLogoUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input?.files?.[0];
  if (!file) return;

  logoUploading.value = true;
  try {
    const formData = new FormData();
    formData.append('logo', file);

    const headers: Record<string, string> = {};
    const ssoPayload = sessionStorage.getItem('ss_sso_payload');
    if (ssoPayload) {
      headers['x-sso-payload'] = ssoPayload;
    }

    const resp = await fetch('/api/merchants/logo', {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!resp.ok) throw new Error('Upload failed');
    const data = await resp.json();
    if (config.value) config.value.logoUrl = data.logoUrl;
  } catch (err) {
    error.value = 'Logo upload failed. Please try again.';
  }
  logoUploading.value = false;
  if (input) input.value = '';
}

async function retryProvision() {
  provisionRetrying.value = true;
  try {
    await api.post<any>('/api/merchants/provision');
    // Wait a moment then refresh config to get updated status
    setTimeout(async () => {
      try {
        config.value = await api.get<any>('/api/merchants/config');
      } catch {}
      provisionRetrying.value = false;
    }, 3000);
  } catch {
    provisionRetrying.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  saved.value = false;
  try {
    const result = await api.put<any>('/api/merchants/config', {
      businessName: config.value.businessName,
      dbaName: config.value.dbaName,
      supportEmail: config.value.supportEmail,
      descriptor: config.value.descriptor,
      businessWebsite: config.value.businessWebsite,
      businessCity: config.value.businessCity,
      businessState: config.value.businessState,
      industryNiche: config.value.industryNiche,
      primaryServiceType: config.value.primaryServiceType,
      logoUrl: config.value.logoUrl,
      shortDescription: config.value.shortDescription,
      enrollmentFunnelUrl: config.value.enrollmentFunnelUrl,
      modules: config.value.modules,
      dunningEnabled: config.value.dunningEnabled,
      dunningMaxRetries: config.value.dunningMaxRetries,
      engagementEnabled: config.value.engagementEnabled,
      config: { disengagement_thresholds: thresholds.value },
    });
    config.value = result;
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 3000);
  } catch {}
  saving.value = false;
}

async function runReconciliation() {
  running.value = 'recon';
  adminResult.value = '';
  try {
    const result = await api.post<any>('/api/admin/reconciliation/run');
    adminResult.value = `Reconciliation complete: ${result.eventsReceived} events, ${result.evidenceLogged} evidence, ${result.mismatches.length} mismatches`;
  } catch {}
  running.value = false;
}

async function runDisengagement() {
  running.value = 'disengage';
  adminResult.value = '';
  try {
    const result = await api.post<any>('/api/admin/disengagement/run');
    adminResult.value = `Disengagement check complete: ${result.flagged} client(s) flagged at-risk`;
  } catch {}
  running.value = false;
}

async function cleanupKeys() {
  running.value = 'cleanup';
  adminResult.value = '';
  try {
    const result = await api.post<any>('/api/admin/idempotency/cleanup');
    adminResult.value = `Cleanup complete: ${result.purged} old keys purged`;
  } catch {}
  running.value = false;
}

let stripeMessageHandler: ((event: MessageEvent) => void) | null = null;
let stripePopup: Window | null = null;

async function connectStripe() {
  stripeConnecting.value = true;
  stripeError.value = '';

  if (stripeMessageHandler) {
    window.removeEventListener('message', stripeMessageHandler);
    stripeMessageHandler = null;
  }
  if (stripePopup && !stripePopup.closed) stripePopup.close();

  try {
    const locationId = config.value?.locationId;
    if (!locationId) {
      stripeError.value = 'Location ID not found. Please refresh and try again.';
      stripeConnecting.value = false;
      return;
    }

    // Open Stripe OAuth in a popup — Stripe refuses to load inside an iframe,
    // so the SPA stays inside GHL (preserving SSO) and the popup handles OAuth.
    const url = '/auth/stripe/connect?locationId=' + encodeURIComponent(locationId);
    stripePopup = window.open(url, 'scalesafe_stripe_oauth', 'width=600,height=750');
    if (!stripePopup) {
      stripeError.value = 'Popup blocked. Please allow popups for this site and try again.';
      stripeConnecting.value = false;
      return;
    }

    stripeMessageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'stripe_connect_result') return;
      window.removeEventListener('message', stripeMessageHandler!);
      stripeMessageHandler = null;
      stripePopup = null;
      stripeConnecting.value = false;

      if (event.data.success) {
        stripeError.value = '';
        stripeConnected.value = true;
        stripeSuccess.value = true;
        setTimeout(() => { stripeSuccess.value = false; }, 5000);
        // Refresh full config so stripeAccountId / nmi / default fields update
        api.get<any>('/api/merchants/config').then((cfg) => {
          config.value = cfg;
          if (cfg.stripeUserId) stripeAccountId.value = cfg.stripeUserId;
        }).catch(() => {});
      } else {
        stripeError.value = 'Stripe connection failed: ' + (event.data.error || 'unknown error');
      }
    };
    window.addEventListener('message', stripeMessageHandler);
  } catch {
    stripeError.value = 'Failed to start Stripe connection. Please try again.';
    stripeConnecting.value = false;
  }
}

async function disconnectStripe() {
  if (!confirm('Disconnect your Stripe account? Payments will stop working until you reconnect.')) return;
  stripeDisconnecting.value = true;
  stripeError.value = '';
  try {
    await api.post<any>('/api/stripe/disconnect');
    stripeConnected.value = false;
    stripeAccountId.value = '';
  } catch {
    stripeError.value = 'Failed to disconnect. Please try again.';
  }
  stripeDisconnecting.value = false;
}

async function setDefaultProcessor(proc: string) {
  defaultProcessorSaved.value = false;
  try {
    await api.post<any>('/api/processor-config/default', { processor: proc });
    defaultProcessor.value = proc;
    defaultProcessorSaved.value = true;
    setTimeout(() => { defaultProcessorSaved.value = false; }, 3000);
  } catch {
    // Silently fail — the select will revert on next load
  }
}
</script>

<style scoped>
.onboarding-banner {
  background: #fef3c7;
  color: #92400e;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
  border-left: 4px solid #f59e0b;
}

.success-msg {
  background: #d1fae5;
  color: #065f46;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

.section-title {
  margin-bottom: 16px;
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
  border-left: 3px solid #e5e7eb;
  padding-left: 16px;
}

.clause-row {
  border-left: 3px solid #dbeafe;
  padding-left: 16px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input {
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

.text-danger {
  color: #dc2626;
}

.badge-red {
  background: #fee2e2;
  color: #dc2626;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.logo-upload-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.logo-preview {
  width: 80px;
  height: 80px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
}

.logo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-link {
  background: none;
  border: none;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.btn-link:hover {
  color: #374151;
}

.processor-status {
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.processor-status.connected {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.green {
  background: #22c55e;
}

.status-dot.yellow {
  background: #f59e0b;
}

.status-dot.red {
  background: #ef4444;
}

.status-text {
  font-weight: 600;
  font-size: 15px;
  color: #166534;
}

.status-details {
  margin-left: 18px;
}

.health-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  font-weight: 600;
}

.health-pass {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.health-warn {
  border-color: #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.health-fail {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.health-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.health-row {
  display: grid;
  grid-template-columns: 12px 1fr;
  gap: 10px;
  align-items: start;
  padding: 10px 0;
  border-bottom: 1px solid #f3f4f6;
}

.health-row:last-child {
  border-bottom: 0;
}

.health-label {
  font-weight: 600;
  font-size: 14px;
  color: #111827;
}
</style>
