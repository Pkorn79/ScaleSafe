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
            <label class="form-label">Merchant Logo URL</label>
            <input class="form-input" v-model="config.logoUrl" placeholder="https://yourdomain.com/logo.png" />
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
          &nbsp;&middot;&nbsp;Snapshot: <span class="badge" :class="config.snapshotStatus === 'installed' ? 'badge-green' : 'badge-yellow'">{{ config.snapshotStatus }}</span>
        </div>
      </div>

      <!-- Terms & Conditions Preferences -->
      <div class="card mb-4">
        <h3 class="section-title">Terms & Conditions</h3>
        <p class="text-sm text-muted mb-4">
          Configure your default T&C preferences. These apply to all offers unless overridden at the offer level.
        </p>

        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" v-model="config.tcHasOwn" />
            I have my own Terms & Conditions document
          </label>
        </div>

        <div v-if="config.tcHasOwn" class="form-group">
          <label class="form-label">T&C Document URL</label>
          <input class="form-input" type="url" v-model="config.tcDocumentUrl"
            placeholder="https://yourdomain.com/terms" />
        </div>

        <div v-if="!config.tcHasOwn">
          <h4 class="mb-4" style="font-size:14px;font-weight:600">ScaleSafe Clause Builder</h4>
          <p class="text-sm text-muted mb-4">
            Toggle ON the standard clauses you want included in your enrollment agreements.
            Clauses marked "Recommended" are enabled by default.
          </p>

          <div v-for="clause in standardClauses" :key="clause.key" class="clause-toggle mb-4">
            <div class="flex-between">
              <div style="flex:1;padding-right:16px">
                <label class="checkbox-label">
                  <input type="checkbox" v-model="config.standardClauses[clause.key]" />
                  <span>
                    {{ clause.label }}
                    <span v-if="clause.recommended" class="badge badge-blue" style="font-size:10px;margin-left:6px">Recommended</span>
                  </span>
                </label>
                <p class="text-sm text-muted mt-2" style="margin-left:24px">{{ clause.text }}</p>
              </div>
            </div>
          </div>

          <h4 class="mt-4 mb-4" style="font-size:14px;font-weight:600">Custom Clauses</h4>
          <p class="text-sm text-muted mb-4">
            Add up to 2 custom clauses with your own title and text.
          </p>

          <div class="clause-row mb-4">
            <div class="form-group">
              <label class="form-label">Custom Clause 1 Title</label>
              <input class="form-input" v-model="config.customClause1Title" placeholder="e.g., Non-Disclosure Agreement" />
            </div>
            <div class="form-group">
              <label class="form-label">Custom Clause 1 Text</label>
              <textarea class="form-textarea" v-model="config.customClause1Text" style="min-height:60px"
                placeholder="Clause text..."></textarea>
            </div>
          </div>

          <div class="clause-row">
            <div class="form-group">
              <label class="form-label">Custom Clause 2 Title</label>
              <input class="form-input" v-model="config.customClause2Title" placeholder="e.g., Intellectual Property" />
            </div>
            <div class="form-group">
              <label class="form-label">Custom Clause 2 Text</label>
              <textarea class="form-textarea" v-model="config.customClause2Text" style="min-height:60px"
                placeholder="Clause text..."></textarea>
            </div>
          </div>
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

const moduleLabels: Record<string, string> = {
  sessions: 'Session Delivery Tracking',
  milestones: 'Milestone Tracking',
  pulse: 'Pulse Check-Ins',
  payments: 'Payment Tracking',
  course: 'Course/Module Tracking',
};

const standardClauses = [
  {
    key: 'include_purchase_summary',
    label: 'Purchase Summary',
    text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
    recommended: true,
  },
  {
    key: 'include_cardholder_authorization',
    label: 'Cardholder Authorization',
    text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
    recommended: true,
  },
  {
    key: 'include_program_scope',
    label: 'Program Scope',
    text: 'I confirm that I have reviewed the program description and understand what is included in this purchase.',
    recommended: false,
  },
  {
    key: 'include_refund_cancellation',
    label: 'Refund & Cancellation',
    text: 'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.',
    recommended: false,
  },
  {
    key: 'include_digital_access',
    label: 'Digital Access',
    text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
    recommended: false,
  },
  {
    key: 'include_participation_responsibility',
    label: 'Participation Responsibility',
    text: 'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.',
    recommended: false,
  },
  {
    key: 'include_no_guaranteed_results',
    label: 'No Guaranteed Results',
    text: 'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.',
    recommended: false,
  },
  {
    key: 'include_installment_billing',
    label: 'Installment Billing',
    text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
    recommended: false,
  },
  {
    key: 'include_feedback_checkin',
    label: 'Feedback & Check-In',
    text: 'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
    recommended: false,
  },
];

onMounted(async () => {
  try {
    config.value = await api.get<any>('/api/merchants/config');
    if (config.value.config?.disengagement_thresholds) {
      Object.assign(thresholds.value, config.value.config.disengagement_thresholds);
    }
  } catch {}
});

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
      tcHasOwn: config.value.tcHasOwn,
      tcDocumentUrl: config.value.tcDocumentUrl,
      standardClauses: config.value.standardClauses,
      customClause1Title: config.value.customClause1Title,
      customClause1Text: config.value.customClause1Text,
      customClause2Title: config.value.customClause2Title,
      customClause2Text: config.value.customClause2Text,
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
</style>
