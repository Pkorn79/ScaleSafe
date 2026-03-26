<template>
  <div>
    <h1 class="page-title">Settings</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="saved" style="background:#d1fae5;color:#065f46;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:14px">
      Settings saved successfully.
    </div>
    <div v-if="loading" class="loading">Loading settings...</div>

    <div v-if="config" class="grid grid-2">
      <!-- Business Info -->
      <div class="card">
        <h3 style="margin-bottom:16px">Business Information</h3>
        <div class="form-group">
          <label class="form-label">Business Name</label>
          <input class="form-input" v-model="config.businessName" />
        </div>
        <div class="form-group">
          <label class="form-label">Support Email</label>
          <input class="form-input" type="email" v-model="config.supportEmail" />
        </div>
        <div class="text-sm text-muted">
          Location ID: {{ config.locationId }}
          <br />Status: <span class="badge badge-green">{{ config.status }}</span>
          <br />Snapshot: <span class="badge" :class="config.snapshotStatus === 'installed' ? 'badge-green' : 'badge-yellow'">{{ config.snapshotStatus }}</span>
        </div>
      </div>

      <!-- Evidence Module Toggles -->
      <div class="card">
        <h3 style="margin-bottom:16px">Evidence Modules</h3>
        <div v-for="(label, key) in moduleLabels" :key="key" class="flex-between mb-4">
          <span class="text-sm">{{ label }}</span>
          <label style="position:relative;display:inline-block;width:48px;height:24px">
            <input type="checkbox" v-model="config.modules[key]" style="opacity:0;width:0;height:0" />
            <span :style="{
              position: 'absolute', inset: 0, borderRadius: '12px', cursor: 'pointer', transition: '0.2s',
              background: config.modules[key] ? '#3b82f6' : '#d1d5db',
            }">
              <span :style="{
                position: 'absolute', width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                top: '3px', transition: '0.2s',
                left: config.modules[key] ? '26px' : '4px',
              }"></span>
            </span>
          </label>
        </div>
      </div>

      <!-- Disengagement Thresholds -->
      <div class="card">
        <h3 style="margin-bottom:16px">Disengagement Thresholds</h3>
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
          <input class="form-input" type="number" v-model.number="thresholds.pulsScoreThreshold" />
        </div>
      </div>

      <!-- Admin Actions -->
      <div class="card">
        <h3 style="margin-bottom:16px">Admin Actions</h3>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-secondary" @click="runReconciliation" :disabled="running">
            {{ running === 'recon' ? 'Running...' : 'Run Reconciliation' }}
          </button>
          <button class="btn btn-secondary" @click="runDisengagement" :disabled="running">
            {{ running === 'disengage' ? 'Running...' : 'Run Disengagement Check' }}
          </button>
          <button class="btn btn-secondary" @click="cleanupKeys" :disabled="running">
            {{ running === 'cleanup' ? 'Running...' : 'Cleanup Old Keys' }}
          </button>
        </div>
        <div v-if="adminResult" class="mt-2 text-sm text-muted">{{ adminResult }}</div>
      </div>
    </div>

    <div class="mt-4" v-if="config">
      <button class="btn btn-primary" @click="saveSettings" :disabled="saving">
        {{ saving ? 'Saving...' : 'Save Settings' }}
      </button>
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
  pulsScoreThreshold: 2,
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
    await api.put('/api/merchants/config', {
      businessName: config.value.businessName,
      supportEmail: config.value.supportEmail,
      modules: config.value.modules,
      config: { disengagement_thresholds: thresholds.value },
    });
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
