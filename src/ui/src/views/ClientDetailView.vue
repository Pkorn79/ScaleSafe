<template>
  <div>
    <div class="flex-between mb-4">
      <div>
        <h1 class="page-title">{{ clientLabel }}</h1>
        <p v-if="clientEmail" class="text-sm text-muted">{{ clientEmail }}</p>
      </div>
      <router-link to="/clients" class="btn btn-secondary">Back</router-link>
    </div>

    <div v-if="pageLoading" class="loading">Loading client data...</div>

    <div v-if="error && !pageLoading" class="error-msg">{{ error }}</div>

    <!-- Readiness Score -->
    <div v-if="score && !pageLoading" class="card mb-4">
      <div class="flex-between">
        <div>
          <div class="card-title">Defense Readiness Score</div>
          <div class="card-value" :style="{ color: scoreColor(score.score) }">{{ score.score }}/100</div>
        </div>
        <div class="score-bar" style="width:200px;height:12px">
          <div class="score-fill" :style="{ width: score.score + '%', background: scoreColor(score.score) }"></div>
        </div>
      </div>
      <div class="grid grid-3 mt-4">
        <div v-for="(val, key) in score.breakdown" :key="key" class="text-sm">
          <strong>{{ formatKey(key as string) }}:</strong> {{ val.points }}/{{ val.max }}
          <div class="text-muted">{{ val.detail }}</div>
        </div>
      </div>
    </div>

    <!-- Enrollment Info -->
    <div v-if="enrollmentInfo && !pageLoading" class="card mb-4">
      <div class="flex-between">
        <div class="card-title">Enrollment Summary</div>
        <button v-if="enrollmentInfo.enrollmentId && ['enrolled', 'completed', 'consent_captured'].includes(enrollmentInfo.status)"
          class="btn btn-sm btn-primary" @click="downloadPacket" :disabled="packetLoading">
          {{ packetLoading ? 'Generating...' : 'Download Enrollment Packet' }}
        </button>
      </div>
      <div class="grid grid-3 mt-2">
        <div class="text-sm"><strong>Status:</strong> {{ enrollmentInfo.status }}</div>
        <div class="text-sm"><strong>Payment:</strong> ${{ enrollmentInfo.paymentAmount?.toFixed(2) || '0.00' }}</div>
        <div class="text-sm"><strong>Enrolled:</strong> {{ enrollmentInfo.enrolledAt ? formatDate(enrollmentInfo.enrolledAt) : 'N/A' }}</div>
      </div>
      <div v-if="enrollmentInfo.offerName" class="text-sm mt-2"><strong>Program:</strong> {{ enrollmentInfo.offerName }}</div>
      <div v-if="enrollmentInfo.signature" class="text-sm mt-2"><strong>Signature:</strong> {{ enrollmentInfo.signature }}</div>
      <div v-if="packetError" class="text-sm mt-2" style="color:#ef4444">{{ packetError }}</div>
    </div>

    <!-- Evidence Timeline -->
    <div v-if="!pageLoading" class="card">
      <div class="card-title mb-4">Evidence Timeline ({{ timeline.length }} records)</div>

      <div v-if="timeline.length === 0" class="empty-state">
        <p>No evidence recorded for this client yet. Evidence is logged automatically as clients enroll, make payments, and engage with your program.</p>
      </div>

      <table v-if="timeline.length > 0" class="table">
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
            <td>
              <span class="badge badge-blue">{{ formatEvidenceType(item.evidence_type || item.type) }}</span>
            </td>
            <td class="text-sm">{{ summarize(item) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const contactId = computed(() => route.params.contactId as string);
const score = ref<any>(null);
const timeline = ref<any[]>([]);
const enrollmentInfo = ref<any>(null);
const clientEmail = ref('');
const clientLabel = ref('Client');
const pageLoading = ref(true);
const packetLoading = ref(false);
const packetError = ref('');

function scoreColor(s: number): string {
  if (s >= 70) return '#10b981';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
}

function formatKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

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
    // Consent evidence
    if (type === 'consent') {
      const parts: string[] = [];
      if (d.digital_signature) parts.push(`Signed: ${d.digital_signature}`);
      const clauses = (d.clauses_accepted || []).filter(Boolean);
      if (clauses.length > 0) parts.push(`${clauses.length} clauses accepted`);
      if (d.scroll_depth != null) parts.push(`${d.scroll_depth}% scroll`);
      if (d.ip_address) parts.push(`IP: ${d.ip_address}`);
      if (parts.length > 0) return parts.join(' | ');
    }
    // Payment evidence
    const parts: string[] = [];
    if (d.amount) parts.push(`$${Number(d.amount).toFixed(2)}`);
    if (d.payment_type) parts.push(d.payment_type);
    if (d.transaction_id) parts.push(`Tx: ${d.transaction_id.slice(0, 12)}...`);
    if (d.timestamp) parts.push(formatDate(d.timestamp));
    if (d.source) parts.push(d.source);
    if (parts.length > 0) return parts.join(' | ');
    // Generic fallback — show key fields, not raw JSON
    const keys = Object.keys(d).filter(k => d[k] != null && d[k] !== '');
    const summary = keys.slice(0, 4).map(k => `${k}: ${String(d[k]).slice(0, 30)}`).join(', ');
    return summary || JSON.stringify(d).slice(0, 80);
  }
  return '-';
}

async function downloadPacket() {
  const eid = enrollmentInfo.value?.enrollmentId;
  if (!eid) return;

  packetLoading.value = true;
  packetError.value = '';
  try {
    const headers: Record<string, string> = {};
    const payload = sessionStorage.getItem('ss_sso_payload');
    if (payload) {
      headers['x-sso-payload'] = payload;
    } else {
      const loc = sessionStorage.getItem('ss_location_id');
      if (loc) headers['x-location-id'] = loc;
      const comp = sessionStorage.getItem('ss_company_id');
      if (comp) headers['x-company-id'] = comp;
      const uid = sessionStorage.getItem('ss_user_id');
      if (uid) headers['x-user-id'] = uid;
    }

    const res = await fetch(`/api/enrollments/${eid}/packet?download=true`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('Packet download failed:', res.status, body);
      packetError.value = `Failed to generate packet (${res.status})`;
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-packet-${eid}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    console.error('Packet download error:', err);
    packetError.value = err.message || 'Download failed';
  } finally {
    packetLoading.value = false;
  }
}

onMounted(async () => {
  const cid = contactId.value;

  const [scoreResult, timelineResult, enrollmentResult] = await Promise.allSettled([
    api.get<any>(`/api/evidence/${cid}/score`),
    api.get<any[]>(`/api/evidence/${cid}`),
    api.get<any>(`/api/dashboard/client-info/${cid}`),
  ]);

  if (scoreResult.status === 'fulfilled') score.value = scoreResult.value;
  if (timelineResult.status === 'fulfilled') timeline.value = timelineResult.value || [];
  if (enrollmentResult.status === 'fulfilled' && enrollmentResult.value) {
    enrollmentInfo.value = enrollmentResult.value;
    clientEmail.value = enrollmentResult.value.email || '';
    clientLabel.value = enrollmentResult.value.name || enrollmentResult.value.email || 'Client';
  } else {
    clientLabel.value = cid.includes('@') ? cid : 'Client';
  }

  pageLoading.value = false;
});
</script>
