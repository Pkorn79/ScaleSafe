<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Active Disputes</h1>
      <router-link to="/defense" class="btn btn-secondary">Back to Defense</router-link>
    </div>

    <div v-if="loadError" class="error-msg">{{ loadError }}</div>
    <div v-if="pageLoading" class="loading">Loading disputes...</div>

    <template v-if="!pageLoading">
      <!-- Summary strip -->
      <div class="grid grid-4 mb-4">
        <div class="card">
          <div class="card-title">Open</div>
          <div class="card-value">{{ openCount }}</div>
        </div>
        <div class="card">
          <div class="card-title">Evidence Submitted</div>
          <div class="card-value">{{ submittedCount }}</div>
        </div>
        <div class="card">
          <div class="card-title">Won</div>
          <div class="card-value" style="color:#10b981">{{ wonCount }}</div>
        </div>
        <div class="card">
          <div class="card-title">Total Exposure</div>
          <div class="card-value">${{ (totalExposure / 100).toFixed(2) }}</div>
        </div>
      </div>

      <!-- Disputes Table -->
      <div v-if="disputes.length > 0" class="card">
        <table class="table">
          <thead>
            <tr>
              <th>Deadline</th>
              <th>Amount</th>
              <th>Reason</th>
              <th>Triage Score</th>
              <th>Recommendation</th>
              <th>Evidence</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in sortedDisputes" :key="d.id">
              <td>
                <div class="text-sm">{{ formatDate(d.evidence_due_by) }}</div>
                <div class="text-sm" :style="{ color: daysLeftColor(d.evidence_due_by) }">
                  {{ daysLeftLabel(d.evidence_due_by) }}
                </div>
              </td>
              <td class="text-sm">${{ Number(d.amount || 0).toFixed(2) }}</td>
              <td>
                <span class="badge badge-blue">{{ formatReasonCode(d.reason) }}</span>
                <span v-if="d.ce3_eligible" class="badge badge-green" style="margin-left:4px" title="Qualifies for Visa Compelling Evidence 3.0 — prior-transaction proof attaches automatically on submit">CE 3.0</span>
              </td>
              <td>
                <div v-if="d.triage_score != null" class="text-sm">
                  <strong>{{ d.triage_score }}</strong>/100
                  <div class="score-bar" style="width:80px">
                    <div class="score-fill" :style="{ width: d.triage_score + '%', background: triageColor(d.triage_score) }"></div>
                  </div>
                </div>
                <span v-else class="text-sm text-muted">--</span>
              </td>
              <td>
                <span v-if="d.triage_recommendation" class="badge" :class="recBadge(d.triage_recommendation)">
                  {{ d.triage_recommendation }}
                </span>
                <span v-else class="text-sm text-muted">--</span>
              </td>
              <td>
                <div v-if="d.evidence_score != null" class="text-sm">
                  {{ d.evidence_score }}%
                  <div v-if="d.evidence_gaps?.length" class="text-sm text-muted">
                    {{ d.evidence_gaps.length }} gap(s)
                  </div>
                </div>
                <span v-else class="text-sm text-muted">--</span>
              </td>
              <td>
                <span class="badge" :class="statusBadge(d.status)">{{ formatStatus(d.status) }}</span>
              </td>
              <td>
                <div class="flex gap-2">
                  <router-link v-if="d.defense_packet_id" :to="`/defense/${d.defense_packet_id}`" class="btn btn-sm btn-primary">
                    Review &amp; Submit
                  </router-link>
                  <button
                    v-else-if="d.status === 'needs_response' || d.status === 'warning_needs_response'"
                    class="btn btn-sm btn-primary"
                    @click="prepareDefense(d)"
                    :disabled="preparing === d.id"
                  >
                    {{ preparing === d.id ? 'Preparing...' : 'Prepare Defense' }}
                  </button>
                  <button
                    v-if="d.status === 'needs_response' || d.status === 'warning_needs_response'"
                    class="btn btn-sm btn-danger"
                    @click="acceptDispute(d)"
                    :disabled="accepting === d.id"
                  >
                    Accept
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="disputes.length === 0" class="empty-state">
        <p>No disputes found. That's a good sign!</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi, ssoSession } from '../composables/useApi';
import { pluralize } from '../utils/humanize';

const api = useApi();
const router = useRouter();

const pageLoading = ref(true);
const loadError = ref<string | null>(null);
const disputes = ref<any[]>([]);
const preparing = ref<string | null>(null);
const accepting = ref<string | null>(null);

const sortedDisputes = computed(() => {
  return [...disputes.value].sort((a, b) => {
    // Sort by deadline ascending (most urgent first)
    const aDate = a.evidence_due_by ? new Date(a.evidence_due_by).getTime() : Infinity;
    const bDate = b.evidence_due_by ? new Date(b.evidence_due_by).getTime() : Infinity;
    return aDate - bDate;
  });
});

const openCount = computed(() => disputes.value.filter(d => !d.outcome || d.outcome === 'pending').length);
const submittedCount = computed(() => disputes.value.filter(d => d.status === 'under_review').length);
const wonCount = computed(() => disputes.value.filter(d => d.outcome === 'won').length);
const totalExposure = computed(() => {
  return disputes.value
    .filter(d => !d.outcome || d.outcome === 'pending')
    .reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
});

onMounted(async () => {
  await loadDisputes();
});

async function loadDisputes() {
  pageLoading.value = true;
  loadError.value = null;
  try {
    const data = await api.get<any>(`/api/disputes/${ssoSession.locationId}`);
    disputes.value = data.disputes || [];
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load disputes';
  } finally {
    pageLoading.value = false;
  }
}

async function prepareDefense(dispute: any) {
  preparing.value = dispute.id;
  try {
    const result = await api.post<any>(`/api/disputes/${ssoSession.locationId}/${dispute.id}/prepare`);
    if (result?.defensePacketId) {
      router.push(`/defense/${result.defensePacketId}`);
      return;
    }
    await loadDisputes();
  } catch (err: any) {
    loadError.value = err.message || 'Failed to prepare defense packet';
  } finally {
    preparing.value = null;
  }
}

async function acceptDispute(dispute: any) {
  if (!confirm(`Accept this $${Number(dispute.amount || 0).toFixed(2)} dispute? This permanently concedes the chargeback — the cardholder keeps the funds, it counts as a loss, and it cannot be undone.`)) return;
  accepting.value = dispute.id;
  try {
    await api.post(`/api/disputes/${ssoSession.locationId}/${dispute.id}/accept`);
    await loadDisputes();
  } catch (err: any) {
    loadError.value = err.message || 'Failed to accept dispute';
  } finally {
    accepting.value = null;
  }
}

function formatDate(d: string): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysLeftLabel(deadline: string): string {
  if (!deadline) return '';
  const now = new Date();
  const due = new Date(deadline);
  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'OVERDUE';
  if (diff === 0) return 'Due today';
  return `${pluralize(diff, 'day')} left`;
}

function daysLeftColor(deadline: string): string {
  if (!deadline) return '#6b7280';
  const now = new Date();
  const due = new Date(deadline);
  const diff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return '#dc2626';
  if (diff <= 3) return '#ea580c';
  if (diff <= 7) return '#d97706';
  return '#6b7280';
}

function formatReasonCode(code: string): string {
  const map: Record<string, string> = {
    fraudulent: 'Fraudulent',
    product_not_received: 'Not Received',
    general: 'Not as Described',
    credit_not_processed: 'Credit Not Processed',
    unrecognized: 'Unrecognized',
  };
  return map[code] || code || 'Unknown';
}

function triageColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function recBadge(rec: string): string {
  const map: Record<string, string> = {
    fight: 'badge-green',
    review: 'badge-yellow',
    accept: 'badge-red',
  };
  return map[rec] || 'badge-gray';
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    needs_response: 'badge-yellow',
    warning_needs_response: 'badge-red',
    under_review: 'badge-blue',
    won: 'badge-green',
    lost: 'badge-red',
    charge_refunded: 'badge-gray',
  };
  return map[status] || 'badge-gray';
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    needs_response: 'Needs Response',
    warning_needs_response: 'Urgent',
    under_review: 'Under Review',
    won: 'Won',
    lost: 'Lost',
    charge_refunded: 'Refunded',
  };
  return map[status] || status || 'Unknown';
}
</script>
