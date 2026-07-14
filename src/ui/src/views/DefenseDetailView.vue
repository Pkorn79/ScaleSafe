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
              <span class="text-sm text-muted">{{ packet.reason_code }} - {{ humanizeReasonCode(packet.reason_code) }} - ${{ Number(packet.dispute_amount || 0).toFixed(2) }}</span>
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
              <template v-if="packet.isStripeDispute">{{ submitting ? 'Submitting to Stripe...' : 'Submit to Stripe' }}</template>
              <template v-else>{{ submitting ? 'Submitting...' : 'Mark Submitted' }}</template>
            </button>
            <router-link to="/defense" class="btn btn-sm btn-secondary">Back</router-link>
          </div>
        </div>

        <!-- Stripe-rail packets: Submit to Stripe is the real submission -->
        <div v-if="packet.isStripeDispute && isPreSubmit" class="deadline-strip" style="margin-bottom:8px">
          This chargeback came through Stripe. <strong>Submit to Stripe</strong> sends the letter and
          the full packet PDF directly to Stripe as your dispute evidence — review everything first,
          because the packet can't be edited after submission.
        </div>

        <!-- Visa CE 3.0: prior-transaction proof that shifts fraud liability to the issuer -->
        <div v-if="packet.ce3?.eligible" class="deadline-strip" style="margin-bottom:8px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46">
          <strong>Visa Compelling Evidence 3.0:</strong>
          <template v-if="packet.ce3.status === 'qualified'">
            qualified — Visa's pre-check accepted the prior-transaction proof. Strongest possible position.
          </template>
          <template v-else-if="packet.ce3.status === 'not_qualified'">
            the submitted set didn't qualify — the dispute continues through standard review with your full evidence packet.
          </template>
          <template v-else>
            this "unauthorized charge" dispute qualifies for prior-transaction proof. When you submit,
            ScaleSafe automatically attaches evidence of this client's past purchases (matching IP,
            email, and device) to shift liability back to the bank.
          </template>
          <div v-if="packet.internal_debug?.ce3_skipped_reasons?.length" class="text-sm" style="margin-top:4px;font-weight:400;opacity:.85">
            Prior-transaction proof couldn't be assembled: {{ packet.internal_debug.ce3_skipped_reasons.join(' ') }}
          </div>
        </div>

        <!-- Deadline countdown -->
        <div class="deadline-strip" :class="deadlineUrgency">
          <strong>Response Deadline:</strong>
          {{ formatDate(packet.deadline) }}
          <span v-if="daysRemaining !== null" style="margin-left:8px">
            ({{ daysRemaining > 0 ? pluralize(daysRemaining, 'day') + ' remaining' : daysRemaining === 0 ? 'Due today' : 'Time expired' }})
          </span>
          <button v-if="isPreSubmit && !editingDeadline" class="btn btn-sm btn-secondary" style="margin-left:10px;padding:2px 8px;font-size:11px" @click="startDeadlineEdit">
            Edit
          </button>
          <div v-if="editingDeadline" style="margin-top:6px;display:flex;gap:8px;align-items:center">
            <input type="date" class="form-input" style="width:auto;padding:4px 8px;font-size:12px" v-model="deadlineDraft" />
            <button class="btn btn-sm btn-primary" style="padding:3px 10px;font-size:11px" :disabled="savingDeadline" @click="saveDeadline">
              {{ savingDeadline ? 'Saving...' : 'Save' }}
            </button>
            <button class="btn btn-sm btn-secondary" style="padding:3px 10px;font-size:11px" @click="editingDeadline = false">Cancel</button>
          </div>
          <div v-if="deadlineLooksOptimistic" class="text-sm" style="margin-top:4px;font-weight:400;opacity:0.85">
            This deadline was defaulted from the card network's maximum window. Processors usually
            require your response sooner — set the actual due date from your processor using Edit.
          </div>
        </div>

        <!-- Needs-review callout -->
        <div v-if="packet.status === 'needs_review'" class="review-callout">
          <strong>⚠️ This packet needs your review before submission.</strong>
          <p class="review-callout-body">
            ScaleSafe could not fully verify this packet — read the letter and exhibits carefully,
            edit or regenerate the letter if needed, and only mark it submitted once you're
            confident it accurately represents this dispute.
          </p>
          <p v-if="reviewReasons" class="review-callout-reasons">{{ reviewReasons }}</p>
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
        <div v-if="isCompiling" class="compilation-callout">
          Compiling the defense letter and evidence bundle. This page will update automatically.
        </div>
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
          :reported-count="exhibitCount"
          :legacy-snapshot="hasLegacyExhibitSnapshot"
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import ProfileTabs, { type TabDef } from '../components/ProfileTabs.vue';
import { FileText, List, Clock, Award } from 'lucide-vue-next';
import LetterTab from './defense/LetterTab.vue';
import ExhibitsTab from './defense/ExhibitsTab.vue';
import HistoryTab from './defense/HistoryTab.vue';
import OutcomeTab from './defense/OutcomeTab.vue';
import { humanizeEventType, humanizeReasonCode, formatCalendarDate, parseDateValue, pluralize } from '../utils/humanize';
import { getDefensePacketExhibitState } from '../utils/viewState';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const packet = ref<any>(null);
const exhibits = ref<any[]>([]);
const exhibitCount = ref(0);
const hasLegacyExhibitSnapshot = ref(false);
const currentVersionNumber = ref(1);
const activeTab = ref('letter');
const submitting = ref(false);
const regenerating = ref(false);
const savingEdit = ref(false);
const actionError = ref('');
let compilationPollTimer: ReturnType<typeof setTimeout> | null = null;
let compilationPollStartedAt = 0;
const COMPILATION_POLL_MS = 2000;
const COMPILATION_POLL_TIMEOUT_MS = 5 * 60 * 1000;

const tabs: TabDef[] = [
  { key: 'letter',   label: 'Letter',   icon: FileText },
  { key: 'exhibits', label: 'Exhibits', icon: List },
  { key: 'history',  label: 'History',  icon: Clock },
  { key: 'outcome',  label: 'Outcome',  icon: Award },
];

const isPreSubmit = computed(() => {
  const ls = packet.value?.lifecycleStatus || packet.value?.lifecycle_status;
  // needs_review packets can still be submitted — after the merchant has reviewed
  // (and optionally edited/regenerated) the letter. The callout above the letter
  // explains why review is required first.
  return ls === 'pending_submission' && ['complete', 'needs_review'].includes(packet.value?.status);
});

const isCompiling = computed(() => ['pending', 'processing'].includes(packet.value?.status));

function stopCompilationPolling() {
  if (compilationPollTimer) clearTimeout(compilationPollTimer);
  compilationPollTimer = null;
}

function scheduleCompilationPoll() {
  stopCompilationPolling();
  if (!isCompiling.value) return;
  if (Date.now() - compilationPollStartedAt >= COMPILATION_POLL_TIMEOUT_MS) {
    actionError.value = 'Defense compilation is taking longer than expected. You can leave this page and return later.';
    return;
  }
  compilationPollTimer = setTimeout(async () => {
    await refresh();
    scheduleCompilationPoll();
  }, COMPILATION_POLL_MS);
}

const daysRemaining = computed(() => {
  const d = packet.value?.deadline || packet.value?.response_deadline;
  if (!d) return null;
  // parseDateValue treats date-only values as local calendar dates (no UTC shift)
  const diff = Math.ceil((parseDateValue(d).getTime() - Date.now()) / 86400000);
  return diff;
});

// Deadlines defaulted before the 20-day operational cap (or hand-entered past
// it) exceed what processors typically allow the merchant. Flag, never rewrite —
// the stored deadline may be a real processor-supplied date.
const deadlineLooksOptimistic = computed(() => {
  const deadline = packet.value?.deadline || packet.value?.response_deadline;
  const disputeDate = packet.value?.dispute_date || packet.value?.chargeback_date;
  if (!deadline || !disputeDate) return false;
  const diffDays = (parseDateValue(deadline).getTime() - parseDateValue(disputeDate).getTime()) / 86400000;
  return diffDays > 20;
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
    needs_review: 'badge-orange',
  };
  return map[status] || 'badge-gray';
}

// Reasons the packet was held for review (stored server-side at compilation time).
const reviewReasons = computed(() => {
  if (packet.value?.status !== 'needs_review') return '';
  return packet.value?.error_message || '';
});

function formatDate(d: string): string {
  return formatCalendarDate(d) || '-';
}

async function refresh() {
  try {
    const nextPacket = await api.get<any>(`/api/defense/${route.params.id}`);
    packet.value = nextPacket;
    currentVersionNumber.value = Number(nextPacket.versionNumber || nextPacket.version_number || 1);
    const exhibitState = getDefensePacketExhibitState(nextPacket);
    exhibits.value = exhibitState.exhibits;
    exhibitCount.value = exhibitState.reportedCount;
    hasLegacyExhibitSnapshot.value = exhibitState.legacySnapshot;
  } catch (e: any) {
    error.value = e.message || 'Failed to refresh defense packet.';
  }
}

async function markSubmitted() {
  if (packet.value?.isStripeDispute) {
    if (!confirm('Submit this evidence to Stripe now? This sends the letter and packet PDF to Stripe for the dispute. You will not be able to edit the packet afterwards.')) return;
  }
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
    if (result?.versionNumber) currentVersionNumber.value = result.versionNumber;
    // Regeneration re-evaluates the packet's status and review reasons on the
    // server (stale "AI draft was unavailable" clears) — refetch the whole
    // packet instead of patching the letter locally, or the old callout persists.
    await refresh();
  } catch (e: any) {
    actionError.value = e.message || 'Failed to regenerate';
  }
  regenerating.value = false;
}

// ── Deadline editing (pre-submission only) ──
const editingDeadline = ref(false);
const deadlineDraft = ref('');
const savingDeadline = ref(false);

function startDeadlineEdit() {
  const d = packet.value?.deadline || packet.value?.response_deadline || '';
  deadlineDraft.value = String(d).slice(0, 10);
  editingDeadline.value = true;
}

async function saveDeadline() {
  if (!deadlineDraft.value) return;
  savingDeadline.value = true;
  actionError.value = '';
  try {
    await api.patch(`/api/defense/${route.params.id}/deadline`, { deadline: deadlineDraft.value });
    editingDeadline.value = false;
    await refresh();
  } catch (e: any) {
    actionError.value = e.message || 'Failed to update deadline';
  }
  savingDeadline.value = false;
}

async function saveLetterEdit(text: string) {
  savingEdit.value = true;
  actionError.value = '';
  try {
    const result = await api.put<any>(`/api/defense/${route.params.id}/letter`, { letterText: text });
    if (result?.versionNumber) {
      currentVersionNumber.value = result.versionNumber;
    }
    // Full refetch: the edit rebundles the PDF server-side, so every derived
    // field (pdf_url, review state) must come back fresh — hand-patching left
    // stale PDF links visible after edits.
    await refresh();
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
  compilationPollStartedAt = Date.now();
  await refresh();
  scheduleCompilationPoll();
});

onUnmounted(stopCompilationPolling);
</script>

<style scoped>
.defense-header {
  position: sticky;
  top: 0;
  background: #f8fafc;
  z-index: 50;
  /* Pull through .page-shell padding so the sticky header spans gutter-to-gutter.
     Values must match .page-shell horizontal padding (App.vue): 32 / 24 / 16. */
  margin: -32px -32px 0;
  padding: 28px 32px 0;
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

.review-callout {
  padding: 12px 14px;
  background: #fff7ed;
  border: 1px solid #fdba74;
  border-left: 4px solid #ea580c;
  border-radius: 6px;
  font-size: 13px;
  color: #7c2d12;
  margin-bottom: 12px;
}

.review-callout-body {
  margin: 6px 0 0;
}

.review-callout-reasons {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid #fed7aa;
  font-size: 12px;
  color: #9a3412;
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

.compilation-callout {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 13px;
}
</style>
