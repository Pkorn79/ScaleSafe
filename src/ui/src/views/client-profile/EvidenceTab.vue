<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Evidence Timeline</div>
      <div class="text-sm text-muted">{{ total }} record{{ total !== 1 ? 's' : '' }}</div>
    </div>

    <!-- Filters -->
    <div class="card mb-4">
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
    <div v-else-if="timeline.length === 0" class="empty-state">
      <p>No evidence matches your filters.</p>
    </div>

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in timeline" :key="i">
            <td class="text-sm">{{ formatDate(item.created_at || item.event_date) }}</td>
            <td><span class="badge badge-blue">{{ formatEvidenceType(item.evidence_type || item.type) }}</span></td>
            <td class="text-sm">{{ summarize(item) }}</td>
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
import { ref, onMounted } from 'vue';
import { useApi } from '../../composables/useApi';

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

const filterType = ref('');
const filterFrom = ref('');
const filterTo = ref('');

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

function summarize(item: any): string {
  const type = item.evidence_type || item.type || '';
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
    const parts: string[] = [];
    if (d.amount) parts.push(`$${Number(d.amount).toFixed(2)}`);
    if (d.payment_type) parts.push(d.payment_type);
    if (d.transaction_id) parts.push(`Tx: ${String(d.transaction_id).slice(0, 12)}...`);
    if (d.timestamp) parts.push(formatDate(d.timestamp));
    if (d.source) parts.push(d.source);
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

async function applyFilters() {
  offset.value = 0;
  await fetchPage(0, false);
}

async function loadMore() {
  await fetchPage(offset.value, true);
}

onMounted(() => fetchPage(0, false));
</script>
