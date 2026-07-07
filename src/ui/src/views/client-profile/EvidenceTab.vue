<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Evidence Timeline</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="text-sm text-muted">{{ total }} record{{ total !== 1 ? 's' : '' }}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card">
      <div class="grid grid-3" style="gap:12px">
        <div>
          <label class="form-label">Type</label>
          <select class="form-select" v-model="filterType" @change="applyFilters">
            <option value="">All types</option>
            <option v-for="t in typeOptions" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
        <div>
          <label class="form-label">From</label>
          <input type="date" class="form-input" v-model="filterFrom" @change="applyFilters" />
        </div>
        <div>
          <label class="form-label">To</label>
          <input type="date" class="form-input" v-model="filterTo" @change="applyFilters" />
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading">Loading evidence...</div>
    <div v-else-if="error" class="error-msg">{{ error }}</div>
    <EmptyState
      v-else-if="timeline.length === 0"
      :icon="FileSearch"
      :title="hasActiveFilters ? 'No matches' : 'No evidence yet'"
      :body="hasActiveFilters
        ? 'No evidence records match the selected type or date range. Clear the filters to see everything.'
        : 'Evidence is captured automatically as the client progresses - consent, payments, sessions, milestones, and check-ins all land here.'"
    />

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Details</th>
            <th>Program</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in timeline" :key="i">
            <td class="text-sm">{{ formatDate(item.created_at || item.event_date) }}</td>
            <td>
              <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start">
                <span class="badge badge-blue">{{ formatEvidenceType(item.evidence_type || item.type) }}</span>
                <span v-if="visibleProofRole(item)" class="badge badge-gray">{{ formatEvidenceType(visibleProofRole(item)) }}</span>
              </div>
            </td>
            <td class="text-sm">
              <div class="evidence-detail">
                <div v-if="exhibitTitle(item)" class="evidence-title">{{ exhibitTitle(item) }}</div>
                <div>{{ summarize(item) }}</div>
                <div v-if="visibleReasonTags(item).length" class="evidence-tags">
                  <span v-for="tag in visibleReasonTags(item)" :key="tag" class="badge badge-gray">{{ formatEvidenceType(tag) }}</span>
                </div>
              </div>
            </td>
            <td class="text-sm evidence-link-cell">
              <span v-if="linkedEnrollmentId(item)" class="badge badge-green">Linked</span>
              <div v-else-if="isLinking(item)" class="evidence-link-box evidence-link-box-inline">
                <select class="form-select" v-model="selectedEnrollmentId">
                  <option value="">Select program...</option>
                  <option v-for="enrollment in enrollments" :key="enrollment.id" :value="enrollment.id">
                    {{ enrollment.offer_name || enrollment.offerName || enrollment.program_name || 'Program' }}
                  </option>
                </select>
                <button class="btn btn-sm btn-primary" @click="saveLink" :disabled="linkSaving || !selectedEnrollmentId">
                  {{ linkSaving ? 'Saving...' : 'Save' }}
                </button>
                <button class="btn btn-sm btn-secondary" @click="cancelLink" :disabled="linkSaving">Cancel</button>
                <span v-if="linkError" class="text-sm" style="color:#dc2626">{{ linkError }}</span>
              </div>
              <button
                v-else-if="canLink(item)"
                class="btn btn-sm btn-secondary"
                @click="startLink(item)"
              >
                Link to Program
              </button>
              <span v-else class="text-muted">Client-level</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="hasMore" class="text-sm mt-4" style="text-align:center">
        <button class="btn btn-sm btn-secondary" @click="loadMore" :disabled="loading">Load more</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { FileSearch } from 'lucide-vue-next';
import { useApi } from '../../composables/useApi';
import EmptyState from '../../components/EmptyState.vue';

const props = defineProps<{
  contactId: string;
}>();

const api = useApi();

const timeline = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const error = ref('');
const hasMore = ref(false);
const offset = ref(0);
const pageSize = 50;
const enrollments = ref<any[]>([]);
const linkingItem = ref<any | null>(null);
const selectedEnrollmentId = ref('');
const linkSaving = ref(false);
const linkError = ref('');

const filterType = ref('');
const filterFrom = ref('');
const filterTo = ref('');

const hasActiveFilters = computed(() => Boolean(filterType.value || filterFrom.value || filterTo.value));
const linkableEvidenceTables = new Set([
  'evidence',
  'evidence_communication',
  'evidence_appointments',
  'evidence_invoices',
  'evidence_service_access',
  'evidence_modules',
  'evidence_course_completion',
  'evidence_custom_events',
  'evidence_external_sessions',
  'evidence_sessions',
  'evidence_pulse_checkins',
  'evidence_milestones',
  'evidence_signoffs',
  'evidence_resource_delivery',
]);

const typeOptions = [
  { value: 'consent', label: 'Consent' },
  { value: 'enrollment_payment', label: 'Enrollment Payment' },
  { value: 'session', label: 'Session' },
  { value: 'module', label: 'Module' },
  { value: 'pulse_checkin', label: 'Pulse Check-in' },
  { value: 'payment_confirmation', label: 'Payment Confirmation' },
  { value: 'failed_payment', label: 'Failed Payment' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'signoff', label: 'Milestone Sign-Off' },
  { value: 'service_access', label: 'Service Access' },
  { value: 'external_session', label: 'External Session' },
  { value: 'course_completion', label: 'Course Completion' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'communication', label: 'Communication' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'resource_delivery', label: 'Resource Delivery' },
  { value: 'refund', label: 'Refund' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'subscription_change', label: 'Subscription Change' },
  { value: 'custom_event', label: 'Custom Event' },
];

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatEvidenceType(type: string): string {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function evidenceData(item: any): any {
  return item?.data && typeof item.data === 'object' ? item.data : {};
}

function defenseMetadata(item: any): any {
  const direct = item?.defense_metadata;
  const nested = evidenceData(item).defense_metadata;
  return direct && typeof direct === 'object'
    ? direct
    : nested && typeof nested === 'object'
      ? nested
      : {};
}

function linkedEnrollmentId(item: any): string {
  return String(item.enrollment_id || evidenceData(item).enrollment_id || '').trim();
}

function canLink(item: any): boolean {
  return Boolean(item.id && item.evidence_table && linkableEvidenceTables.has(item.evidence_table) && enrollments.value.length > 0);
}

function isLinking(item: any): boolean {
  return Boolean(linkingItem.value && linkingItem.value.id === item.id && linkingItem.value.evidence_table === item.evidence_table);
}

function exhibitTitle(item: any): string {
  const title = String(item.issuer_exhibit_title || evidenceData(item).issuer_exhibit_title || '').trim();
  if (evidenceType(item) === 'communication') {
    const normalized = title.toLowerCase();
    if (!normalized || normalized === 'communication' || normalized === 'merchant communication') return '';
  }
  return title;
}

function proofRole(item: any): string {
  return String(item.proof_role || evidenceData(item).proof_role || '').trim();
}

function reasonTags(item: any): string[] {
  const tags = item.reason_code_tags || evidenceData(item).reason_code_tags || [];
  return Array.isArray(tags) ? tags.filter(Boolean).slice(0, 4) : [];
}

function evidenceType(item: any): string {
  return String(item.evidence_type || item.type || '').trim();
}

function visibleProofRole(item: any): string {
  if (evidenceType(item) === 'communication') return '';
  const role = proofRole(item);
  return role && role !== evidenceType(item) ? role : '';
}

function visibleReasonTags(item: any): string[] {
  if (['communication', 'pulse_checkin'].includes(evidenceType(item))) return [];
  return reasonTags(item);
}

function stripHtml(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLabel(source: string): string {
  if (source === 'nmi_history_sync') return 'NMI history sync';
  if (source === 'nmi_silent_post') return 'NMI Silent Post';
  if (source === 'nmi_webhook_event') return 'NMI webhook';
  if (source === 'merchant_action') return 'Merchant action';
  return source ? source.replace(/_/g, ' ') : '';
}

function titleCase(value: string): string {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
}

function lineItemAmount(item: any): number {
  const raw = item?.amount ?? item?.price ?? (item?.amountCents != null ? Number(item.amountCents) / 100 : 0);
  const amount = Number(raw || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function checkoutLineItemSummary(value: unknown): string {
  const items = Array.isArray(value) ? value : [];
  const labels = items
    .filter((item: any) => item && (item.kind || item.type) !== 'base_offer')
    .map((item: any) => {
      const itemType = item.kind || item.type;
      const title = String(item.title || item.label || item.name || (itemType === 'pre_payment_upsell' ? 'Upgrade' : 'Add-on')).trim();
      const amount = lineItemAmount(item);
      const price = amount > 0 ? ` $${amount.toFixed(2)}` : '';
      const prefix = itemType === 'pre_payment_upsell' ? 'Upgrade' : 'Add-on';
      return `${prefix}: ${title}${price}`;
    });
  return labels.join(', ');
}

function summarize(item: any): string {
  const type = evidenceType(item);
  const defenseSummary = item.defense_summary || evidenceData(item).defense_summary;
  if (typeof defenseSummary === 'string' && defenseSummary.trim()) {
    return stripHtml(defenseSummary.trim());
  }

  const d = item.data || item.summary || item.details;
  if (!d) return '-';
  if (typeof d === 'string') return d.slice(0, 120);
  if (typeof d === 'object') {
    if (type === 'consent') {
      const parts: string[] = [];
      if (d.digital_signature) parts.push(`Signed: ${d.digital_signature}`);
      const clauses = (d.clauses_accepted || []).filter(Boolean);
      if (clauses.length > 0) parts.push(`${clauses.length} clauses accepted`);
      if (d.scroll_depth != null) parts.push(`${d.scroll_depth}% scroll`);
      if (d.ip_address) parts.push(`IP: ${d.ip_address}`);
      if (parts.length > 0) return parts.join(' | ');
    }
    if (type === 'milestone') {
      const actor = sourceLabel(d.source || item.source || 'merchant_action') || 'Merchant action';
      const milestoneNumber = d.milestone_number || d.milestoneNumber;
      const milestoneName = d.milestone_name || d.milestoneName || 'Milestone';
      const details: string[] = [];
      details.push(`${actor}: ${milestoneNumber ? `Milestone ${milestoneNumber}` : 'Milestone'} complete - ${milestoneName}`);
      if (d.description) details.push(`Delivered: ${d.description}`);
      if (d.notes) details.push(`Client responsibility: ${d.notes}`);
      if (d.completed_at) details.push(`Completed: ${formatDate(d.completed_at)}`);
      return details.join(' | ');
    }
    if (type === 'payment_confirmation' && (d.source === 'nmi_history_sync' || item.source === 'nmi_history_sync')) {
      const amount = d.amount ? `$${Number(d.amount).toFixed(2)}` : 'payment';
      const paymentNumber = d.payment_number ? ` #${d.payment_number}` : '';
      const tx = d.ghl_transaction_id || d.transaction_id;
      return `NMI history sync recorded ${amount} payment${paymentNumber}${tx ? `, Tx: ${String(tx).slice(0, 12)}...` : ''}.`;
    }
    if (type === 'enrollment_payment' || type === 'payment_confirmation') {
      const parts: string[] = [];
      if (d.amount) parts.push(`$${Number(d.amount).toFixed(2)}`);
      if (d.payment_type) parts.push(d.payment_type);
      if (d.transaction_id) parts.push(`Tx: ${String(d.transaction_id).slice(0, 12)}...`);
      const itemSummary = checkoutLineItemSummary(d.line_items);
      if (itemSummary) parts.push(itemSummary);
      if (d.timestamp) parts.push(formatDate(d.timestamp));
      if (d.source) parts.push(sourceLabel(d.source));
      if (parts.length > 0) return parts.join(' | ');
    }
    if (type === 'appointment') {
      const title = d.appointment_title || d.title || 'GHL appointment';
      const status = d.appointment_status || d.status || 'recorded';
      const when = d.start_time || d.occurredAt || d.created_at;
      return `${title} - ${formatEvidenceType(String(status))}${when ? ` on ${formatDate(when)}` : ''}`;
    }
    if (type === 'communication') {
      const metadata = defenseMetadata(item).communication || {};
      const directionValue = d.direction || metadata.direction;
      const direction = directionValue === 'inbound' ? 'Inbound from client' : 'Outbound to client';
      const channel = metadata.sourceChannel || titleCase(String(d.comm_type || metadata.channel || 'message'));
      const nature = metadata.natureLabel || metadata.purpose || '';
      const conversation = d.ghl_conversation_id ? ` - GHL conversation ${String(d.ghl_conversation_id).slice(0, 10)}` : '';
      const preview = stripHtml(String(d.summary || d.body_preview || '')).slice(0, 240);
      return `${direction} - ${channel}${nature ? ` - ${titleCase(nature)}` : ''}${conversation}${preview ? `. Preview: ${preview}` : ''}`;
    }
    if (type === 'invoice') {
      const invoice = d.invoice_number || d.invoice_id || 'GHL invoice';
      const status = d.invoice_status || d.status || d.invoice_event_type || 'recorded';
      const amount = d.amount ? ` - $${Number(d.amount).toFixed(2)}` : '';
      return `${invoice} - ${formatEvidenceType(String(status))}${amount}`;
    }
    const parts: string[] = [];
    if (d.amount) parts.push(`$${Number(d.amount).toFixed(2)}`);
    if (d.payment_type) parts.push(d.payment_type);
    if (d.transaction_id) parts.push(`Tx: ${String(d.transaction_id).slice(0, 12)}...`);
    if (d.timestamp) parts.push(formatDate(d.timestamp));
    if (d.source) parts.push(sourceLabel(d.source));
    if (parts.length > 0) return parts.join(' | ');
    const keys = Object.keys(d).filter(k => d[k] != null && d[k] !== '');
    const summary = keys.slice(0, 4).map(k => `${k}: ${String(d[k]).slice(0, 30)}`).join(', ');
    return summary || JSON.stringify(d).slice(0, 80);
  }
  return '-';
}

function buildQuery(off: number): string {
  const params = new URLSearchParams();
  params.set('limit', String(pageSize));
  params.set('offset', String(off));
  if (filterType.value) params.set('type', filterType.value);
  if (filterFrom.value) params.set('from', filterFrom.value);
  if (filterTo.value) params.set('to', filterTo.value);
  return params.toString();
}

async function fetchPage(off: number, append = false) {
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get<any>(`/api/evidence/${props.contactId}?${buildQuery(off)}`);
    // Endpoint returns either { rows, total } or a raw array (backward compat)
    const rows = Array.isArray(result) ? result : (result?.rows || []);
    const totalCount = Array.isArray(result) ? rows.length : (result?.total ?? rows.length);
    if (append) timeline.value = [...timeline.value, ...rows];
    else timeline.value = rows;
    total.value = totalCount;
    hasMore.value = timeline.value.length < totalCount;
    offset.value = off + rows.length;
  } catch (e: any) {
    error.value = e.message || 'Failed to load evidence';
  }
  loading.value = false;
}

async function fetchEnrollments() {
  try {
    const result = await api.get<any>(`/api/dashboard/client-enrollments/${props.contactId}`);
    enrollments.value = Array.isArray(result) ? result : (result?.enrollments || result?.items || []);
  } catch {
    enrollments.value = [];
  }
}

function startLink(item: any) {
  linkingItem.value = item;
  selectedEnrollmentId.value = '';
  linkError.value = '';
}

function cancelLink() {
  linkingItem.value = null;
  selectedEnrollmentId.value = '';
  linkError.value = '';
}

async function saveLink() {
  if (!linkingItem.value || !selectedEnrollmentId.value) return;
  linkSaving.value = true;
  linkError.value = '';
  try {
    await api.post(`/api/evidence/${props.contactId}/link-program`, {
      evidenceTable: linkingItem.value.evidence_table,
      evidenceId: linkingItem.value.id,
      enrollmentId: selectedEnrollmentId.value,
    });
    cancelLink();
    await fetchPage(0, false);
  } catch (e: any) {
    linkError.value = e.message || 'Failed to link evidence';
  }
  linkSaving.value = false;
}

async function applyFilters() {
  offset.value = 0;
  await fetchPage(0, false);
}

async function loadMore() {
  await fetchPage(offset.value, true);
}

onMounted(async () => {
  await Promise.all([fetchEnrollments(), fetchPage(0, false)]);
});
</script>

<style scoped>
.evidence-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.evidence-title {
  color: var(--text, #111827);
  font-weight: 600;
  line-height: 1.35;
}

.evidence-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.evidence-link-cell {
  white-space: nowrap;
}

.evidence-link-box {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.evidence-link-box .form-select {
  max-width: 320px;
}

.evidence-link-box-inline {
  justify-content: flex-end;
  max-width: 420px;
}
</style>
