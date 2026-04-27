<template>
  <div class="defense-detail">
    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading defense packet...</div>

    <template v-if="packet">
      <!-- Sticky header -->
      <header class="defense-header">
        <div class="defense-header-main">
          <div>
            <h1 class="defense-title">Defense Packet</h1>
            <div class="defense-meta">
              <span class="badge" :class="lifecycleBadge">{{ humanizeEventType(packet.lifecycleStatus || packet.lifecycle_status || 'pending_submission') }}</span>
              <span class="badge" :class="statusBadge(packet.status)">{{ humanizeEventType(packet.status) }}</span>
              <span class="text-sm text-muted">{{ packet.reason_code }} — {{ humanizeReasonCode(packet.reason_code) }} · ${{ Number(packet.dispute_amount || 0).toFixed(2) }}</span>
            </div>
          </div>
          <div class="flex gap-2">
            <a v-if="packet.pdf_url" :href="packet.pdf_url" target="_blank" class="btn btn-sm btn-primary" download>Download PDF</a>
            <button
              v-if="isPreSubmit"
              class="btn btn-sm btn-success"
              @click="markSubmitted"
              :disabled="submitting"
            >
              {{ submitting ? 'Submitting...' : 'Mark Submitted' }}
            </button>
            <router-link to="/defense" class="btn btn-sm btn-secondary">Back</router-link>
          </div>
        </div>

        <!-- Deadline countdown -->
        <div class="deadline-strip" :class="deadlineUrgency">
          <strong>Response Deadline:</strong>
          {{ formatDate(packet.deadline) }}
          <span v-if="daysRemaining !== null" style="margin-left:8px">
            ({{ daysRemaining > 0 ? daysRemaining + ' days remaining' : daysRemaining === 0 ? 'Due today' : 'Overdue by ' + Math.abs(daysRemaining) + ' days' }})
          </span>
        </div>

        <!-- PDF inline preview -->
        <div v-if="packet.pdf_url" class="pdf-preview-container">
          <iframe
            :src="packet.pdf_url"
            class="pdf-iframe"
            title="Defense packet PDF preview"
          ></iframe>
        </div>

        <!-- Tab nav -->
        <ProfileTabs v-model="activeTab" :tabs="tabs" />
      </header>

      <!-- Tab bodies -->
      <section class="tab-body">
        <LetterTab
          v-if="activeTab === 'letter'"
          :letter-text="packet.defense_letter_text || ''"
          :status="packet.status"
          :lifecycle-status="packet.lifecycleStatus || packet.lifecycle_status || 'pending_submission'"
          :version-number="currentVersionNumber"
          :input-tokens="packet.input_tokens"
          :output-tokens="packet.output_tokens"
          :regenerating="regenerating"
          :saving="savingEdit"
          :error="actionError"
          @regenerate="regenerateLetter"
          @save="saveLetterEdit"
        />
        <ExhibitsTab
          v-else-if="activeTab === 'exhibits'"
          :exhibits="exhibits"
        />
        <HistoryTab
          v-else-if="activeTab === 'history'"
          :defense-id="packet.id"
        />
        <OutcomeTab
          v-else-if="activeTab === 'outcome'"
          :defense-id="packet.id"
          :lifecycle-status="packet.lifecycleStatus || packet.lifecycle_status || 'pending_submission'"
          :dispute-amount="Number(packet.dispute_amount || 0)"
          :existing-outcome="packet.outcome || null"
          @outcome-recorded="refresh"
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import ProfileTabs, { type TabDef } from '../components/ProfileTabs.vue';
import { FileText, List, Clock, Award } from 'lucide-vue-next';
import LetterTab from './defense/LetterTab.vue';
import ExhibitsTab from './defense/ExhibitsTab.vue';
import HistoryTab from './defense/HistoryTab.vue';
import OutcomeTab from './defense/OutcomeTab.vue';
import { humanizeEventType, humanizeReasonCode } from '../utils/humanize';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const packet = ref<any>(null);
const exhibits = ref<any[]>([]);
const currentVersionNumber = ref(1);
const activeTab = ref('letter');
const submitting = ref(false);
const regenerating = ref(false);
const savingEdit = ref(false);
const actionError = ref('');

const tabs: TabDef[] = [
  { key: 'letter',   label: 'Letter',   icon: FileText },
  { key: 'exhibits', label: 'Exhibits', icon: List },
  { key: 'history',  label: 'History',  icon: Clock },
  { key: 'outcome',  label: 'Outcome',  icon: Award },
];

const isPreSubmit = computed(() => {
  const ls = packet.value?.lifecycleStatus || packet.value?.lifecycle_status;
  return ls === 'pending_submission' && packet.value?.status === 'complete';
});

const daysRemaining = computed(() => {
  const d = packet.value?.deadline || packet.value?.response_deadline;
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return diff;
});

const deadlineUrgency = computed(() => {
  const d = daysRemaining.value;
  if (d === null) return '';
  if (d <= 0) return 'deadline-overdue';
  if (d <= 3) return 'deadline-critical';
  if (d <= 7) return 'deadline-warning';
  return '';
});

const lifecycleBadge = computed(() => {
  const ls = packet.value?.lifecycleStatus || packet.value?.lifecycle_status || '';
  if (ls === 'pending_submission') return 'badge-yellow';
  if (ls === 'submitted') return 'badge-blue';
  if (ls === 'won') return 'badge-green';
  if (ls === 'lost') return 'badge-red';
  if (ls === 'withdrawn') return 'badge-gray';
  return 'badge-gray';
});

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-yellow', processing: 'badge-blue',
    complete: 'badge-green', failed: 'badge-red',
  };
  return map[status] || 'badge-gray';
}

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function refresh() {
  try {
    packet.value = await api.get<any>(`/api/defense/${route.params.id}`);
  } catch {}
}

async function markSubmitted() {
  submitting.value = true;
  actionError.value = '';
  try {
    await api.post(`/api/defense/${route.params.id}/submit`, {});
    await refresh();
  } catch (e: any) {
    actionError.value = e.message || 'Failed to mark as submitted';
  }
  submitting.value = false;
}

async function regenerateLetter() {
  regenerating.value = true;
  actionError.value = '';
  try {
    const result = await api.post<any>(`/api/defense/${route.params.id}/regenerate`, {});
    if (result?.letterText) {
      packet.value = { ...packet.value, defense_letter_text: result.letterText, pdf_url: result.pdfUrl || packet.value.pdf_url };
      currentVersionNumber.value = result.versionNumber || currentVersionNumber.value + 1;
    }
  } catch (e: any) {
    actionError.value = e.message || 'Failed to regenerate';
  }
  regenerating.value = false;
}

async function saveLetterEdit(text: string) {
  savingEdit.value = true;
  actionError.value = '';
  try {
    const result = await api.put<any>(`/api/defense/${route.params.id}/letter`, { letterText: text });
    if (result?.versionNumber) {
      packet.value = { ...packet.value, defense_letter_text: text, pdf_url: result.pdfUrl || packet.value.pdf_url };
      currentVersionNumber.value = result.versionNumber;
    }
  } catch (e: any) {
    actionError.value = e.message || 'Failed to save';
  }
  savingEdit.value = false;
}

// Persist active tab to URL hash
watch(activeTab, (val) => {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.hash = val;
    window.history.replaceState({}, '', url.toString());
  }
});

onMounted(async () => {
  const hash = (typeof window !== 'undefined' && window.location.hash || '').replace('#', '');
  if (tabs.some(t => t.key === hash)) activeTab.value = hash;
  await refresh();
});
</script>

<style scoped>
.defense-header {
  position: sticky;
  top: 0;
  background: #f8fafc;
  z-index: 50;
  /* Pull through .page-shell padding so the sticky header spans gutter-to-gutter.
     Values must match .page-shell padding (App.vue): 32px / 24px / 20px. */
  margin: -32px -40px 0;
  padding: 28px 40px 0;
}
@media (max-width: 1024px) {
  .defense-header {
    margin: -24px -24px 0;
    padding: 20px 24px 0;
  }
}
@media (max-width: 640px) {
  .defense-header {
    margin: -20px -16px 0;
    padding: 16px 16px 0;
  }
}

.defense-header-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.defense-title {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
  margin: 0 0 4px;
}

.defense-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.deadline-strip {
  padding: 8px 14px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}

.deadline-warning {
  background: #fffbeb;
  border-color: #fde68a;
  color: #92400e;
}

.deadline-critical {
  background: #fef2f2;
  border-color: #fecaca;
  color: #991b1b;
}

.deadline-overdue {
  background: #fef2f2;
  border-color: #f87171;
  color: #7f1d1d;
  font-weight: 600;
}

.pdf-preview-container {
  margin-bottom: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.pdf-iframe {
  width: 100%;
  height: calc(100vh - 400px);
  min-height: 300px;
  border: none;
}

.tab-body {
  padding-top: 4px;
}
</style>
