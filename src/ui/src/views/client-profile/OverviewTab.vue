<template>
  <div>
    <!-- Readiness score card -->
    <div v-if="score" class="card">
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
          <strong>{{ formatKey(String(key)) }}:</strong> {{ val.points }}/{{ val.max }}
          <div class="text-muted">{{ val.detail }}</div>
        </div>
      </div>
    </div>

    <!-- Quick stats -->
    <div class="grid grid-3 mb-4">
      <div class="card">
        <div class="card-title">Active Programs</div>
        <div class="card-value">{{ summary?.active || 0 }}</div>
      </div>
      <div class="card">
        <div class="card-title">Paid Lifetime</div>
        <div class="card-value">${{ Number(enrollmentInfo?.totalCharged || 0).toFixed(2) }}</div>
        <div v-if="programTotal > 0" class="text-sm text-muted" style="margin-top:4px">
          of ${{ programTotal.toFixed(2) }} program total
        </div>
      </div>
      <div class="card">
        <div class="card-title">{{ isRecurring ? 'Installment Progress' : 'Next Billing' }}</div>
        <div v-if="isRecurring" style="margin-top:4px">
          <div class="card-value" style="font-size:18px">
            {{ enrollmentInfo?.paymentsMade || 0 }} of {{ enrollmentInfo?.paymentsTotal || '?' }} paid
          </div>
          <div class="text-sm text-muted" style="margin-top:4px">
            <span v-if="nextBillingDisplay">Next: {{ nextBillingDisplay }}</span>
            <span v-else>-</span>
          </div>
        </div>
        <div v-else class="card-value" style="font-size:18px">
          {{ nextBillingDisplay || '-' }}
        </div>
      </div>
    </div>

    <!-- Recent activity (latest 5) -->
    <div class="card">
      <div class="card-title">Recent Activity</div>
      <div v-if="(recentActivity || []).length === 0" class="text-sm text-muted" style="margin-top:8px">
        No activity yet.
      </div>
      <div v-else style="margin-top:8px">
        <div v-for="(item, i) in recentActivity" :key="i" class="activity-row">
          <span class="badge badge-blue" style="margin-right:8px">{{ formatEvidenceType(item.evidence_type || item.type) }}</span>
          <span class="text-sm" style="flex:1">{{ summarize(item) }}</span>
          <span class="text-sm text-muted" style="white-space:nowrap">{{ formatDateShort(item.created_at || item.event_date) }}</span>
        </div>
      </div>
    </div>

    <!-- Most recent note -->
    <div class="card">
      <div class="card-title">Most Recent Note</div>
      <div v-if="recentNote" class="text-sm" style="margin-top:8px;white-space:pre-wrap">
        {{ recentNote.body }}
        <div class="text-muted" style="margin-top:4px;font-size:11px">{{ formatDate(recentNote.createdAt) }}</div>
      </div>
      <div v-else class="text-sm text-muted" style="margin-top:8px">
        No notes yet.
      </div>
    </div>

    <!-- At-risk / engaged pill -->
    <div class="card">
      <div class="card-title">Engagement Status</div>
      <div v-if="atRisk?.flagged" style="margin-top:8px">
        <span class="badge badge-red">At Risk</span>
        <div class="text-sm text-muted" style="margin-top:6px">
          <div v-for="(factor, i) in atRisk.riskFactors || []" :key="i">- {{ factor }}</div>
        </div>
      </div>
      <div v-else style="margin-top:8px">
        <span class="badge badge-green">Engaged</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  contactId: string;
  score: any;
  enrollmentInfo: any;
  enrollments: any[];
  summary: any;
  recentActivity: any[];
  recentNote: { body: string; createdAt: string } | null;
  atRisk: { flagged: boolean; riskFactors: string[] } | null;
}>();

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

function formatDateShort(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatEvidenceType(type: string): string {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function summarize(item: any): string {
  const d = item.data || item.summary || item.details;
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 80);
  if (typeof d === 'object') {
    if (d.amount) return `$${Number(d.amount).toFixed(2)} ${d.payment_type || ''}`;
    if (d.summary) return String(d.summary).slice(0, 80);
    if (d.digital_signature) return `Signed: ${d.digital_signature}`;
    const keys = Object.keys(d).filter(k => d[k] != null && d[k] !== '');
    return keys.slice(0, 2).map(k => String(d[k]).slice(0, 30)).join(' - ') || '';
  }
  return '';
}

// Next billing: soonest across all active enrollments with installment frequency
const nextBillingDisplay = computed(() => {
  if (!props.enrollments) return '';
  const upcoming = props.enrollments
    .filter(e => ['enrolled', 'active'].includes(e.status))
    .map(e => e.nextBillingDate)
    .filter(Boolean)
    .sort();
  if (upcoming.length === 0) return '';
  return formatDateShort(upcoming[0]);
});

// Recurring? (drives whether to show installment progress card vs next-billing card)
const isRecurring = computed(() => {
  const t = String(props.enrollmentInfo?.paymentType || '').toLowerCase();
  return t === 'installments' || t === 'installment' || t === 'subscription';
});

// Program total = paymentsTotal × installmentAmount (or 0 if not applicable)
const programTotal = computed(() => {
  const made = Number(props.enrollmentInfo?.paymentsTotal || 0);
  const amt = Number(props.enrollmentInfo?.installmentAmount || 0);
  return made > 0 && amt > 0 ? made * amt : 0;
});
</script>

<style scoped>
.activity-row {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
  gap: 8px;
}

.activity-row:last-child {
  border-bottom: none;
}
</style>
