<template>
  <div>
    <h1 class="page-title">Merchant Setup</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="saved" class="success-msg">Settings saved successfully.</div>
    <div v-if="loading" class="loading">Loading settings...</div>

    <div v-if="config">
      <!-- Onboarding Status Banner -->
      <div v-if="!config.onboardingComplete" class="onboarding-banner">
        Complete your business setup below to start creating offers. Fields marked * are required.
      </div>

      <!-- Business Information -->
      <div class="card mb-4">
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

      <!-- Evidence Module Toggles -->
      <div class="card mb-4">
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

      <!-- Disengagement Thresholds -->
      <div class="card mb-4">
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
      <div class="card mb-4">
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';

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
    if (config.value.config?.disengagement_thresholds) {
      Object.assign(thresholds.value, config.value.config.disengagement_thresholds);
    }
    // Auto-retry provisioning if failed or pending
    if (config.value && (config.value.snapshotStatus === 'failed' || config.value.snapshotStatus === 'pending' || config.value.snapshotStatus === 'partial')) {
      retryProvision();
    }
  } catch {}
});

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
    } else {
      const locId = sessionStorage.getItem('ss_location_id');
      if (locId) headers['x-location-id'] = locId;
      const compId = sessionStorage.getItem('ss_company_id');
      if (compId) headers['x-company-id'] = compId;
      const userId = sessionStorage.getItem('ss_user_id');
      if (userId) headers['x-user-id'] = userId;
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
      modules: config.value.modules,
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
</style>
