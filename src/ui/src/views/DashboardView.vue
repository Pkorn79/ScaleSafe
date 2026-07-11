<template>
  <div>
    <SectionHeader
      eyebrow="Overview"
      :title="['Your', 'dashboard.']"
      description="Real-time view of active offers, clients, evidence captured, and chargeback defense activity."
    >
      <template #actions>
        <Pill v-if="isStale" tone="amber" :icon="AlertTriangle">Data may be stale</Pill>
        <button
          class="btn btn-sm btn-secondary"
          :disabled="refreshing"
          @click="loadData"
          :title="lastUpdatedAt ? `Last updated ${formatTimestamp(lastUpdatedAt, 'relative', tickNow)}` : ''"
        >
          <RefreshCw :size="14" :class="{ 'spin': refreshing }" style="margin-right: 6px; vertical-align: -2px;" />
          {{ refreshing ? 'Refreshing...' : 'Refresh' }}
        </button>
      </template>
    </SectionHeader>

    <div v-if="lastUpdatedAt" class="dashboard-updated-line">
      Updated {{ formatTimestamp(lastUpdatedAt, 'relative', tickNow) }}
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Skeleton placeholder on first load (no data yet) instead of dead-air text -->
    <div v-if="loading && !data" aria-busy="true" aria-label="Loading dashboard">
      <div class="grid grid-4 mb-4">
        <div v-for="n in 4" :key="n" class="card">
          <Skeleton width="45%" height="11px" radius="4px" />
          <Skeleton width="65%" height="30px" radius="6px" style="margin-top: 12px;" />
        </div>
      </div>
      <div class="grid grid-2">
        <div v-for="col in 2" :key="col" class="card">
          <Skeleton width="40%" height="16px" />
          <div class="dashboard-skeleton-rows">
            <Skeleton v-for="n in 4" :key="n" height="14px" radius="6px" />
          </div>
        </div>
      </div>
    </div>

    <div v-if="data" class="grid grid-4 mb-4">
      <Stat
        label="Active Offers"
        :value="data.activeOffers"
        accent="emerald"
      />
      <Stat
        label="Active Clients"
        :value="data.activeClients"
        accent="navy"
      />
      <Stat
        label="Evidence Records"
        :value="data.totalEvidenceRecords.toLocaleString()"
        accent="teal"
      />
      <Stat
        label="Total Value Recovered"
        :value="`$${data.totalValueSaved.toLocaleString()}`"
        accent="emerald"
        description="Lifetime"
      />
    </div>

    <!-- Deadline urgency: a chargeback response window missed = automatic loss -->
    <div v-if="dueSoonCount > 0" class="card mb-4" style="background:#fee2e2;border:1px solid #fca5a5">
      <div class="text-sm" style="color:#991b1b;font-weight:600">
        ⚠ {{ dueSoonCount }} dispute{{ dueSoonCount === 1 ? '' : 's' }} due within 3 days.
        A missed response deadline is an automatic loss — submit the evidence now.
      </div>
    </div>

    <!-- Open disputes: the merchant's action queue. Submit + outcome prompts live
         here so tracking doesn't depend on anyone reopening a packet. -->
    <div class="card mb-4" v-if="openDisputes.length > 0 || unmatchedDisputes.length > 0">
      <SectionHeader :title="['Open', 'disputes.']">
        <template #actions>
          <router-link to="/defense" class="btn btn-sm btn-secondary">View All</router-link>
        </template>
      </SectionHeader>
      <!-- Unmatched Stripe disputes: no packet exists — the merchant must act
           from the dispute queue or the deadline passes silently. -->
      <div v-for="d in unmatchedDisputes" :key="d.id" class="flex-between mb-4" style="gap:12px;flex-wrap:wrap;cursor:pointer" @click="$router.push('/defense/disputes')">
        <div>
          <div class="text-sm">
            <strong>Unmatched Stripe dispute</strong>
            <span class="badge badge-red" style="margin-left:8px">{{ d.reason || 'unknown' }}</span>
            <span style="margin-left:8px">${{ Number(d.amount || 0).toFixed(2) }}</span>
          </div>
          <div class="text-sm text-muted">
            Couldn't be matched to a client automatically{{ d.evidence_due_by ? ` — respond by ${new Date(d.evidence_due_by).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '' }}
          </div>
        </div>
        <span class="btn btn-sm btn-primary" style="padding:3px 12px;font-size:11px">Open Dispute Queue</span>
      </div>
      <div v-for="d in openDisputes" :key="d.id" class="flex-between mb-4" style="gap:12px;flex-wrap:wrap;cursor:pointer" @click="$router.push(`/defense/${d.id}`)">
        <div>
          <div class="text-sm">
            <strong>{{ d.contactName || 'Unknown' }}</strong>
            <span class="badge badge-blue" style="margin-left:8px">{{ d.reason_code }}</span>
            <span style="margin-left:8px">${{ Number(d.dispute_amount || 0).toFixed(2) }}</span>
          </div>
          <div class="text-sm text-muted">
            {{ (d.lifecycleStatus || d.lifecycle_status) === 'submitted' ? 'Submitted — awaiting the bank\'s decision' : 'Packet ready — not yet submitted' }}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <template v-if="(d.lifecycleStatus || d.lifecycle_status) === 'submitted'">
            <span class="text-sm text-muted">{{ d.isStripeDispute ? 'Stripe reports this automatically' : 'Heard back?' }}</span>
            <button class="btn btn-sm btn-primary" style="padding:3px 12px;font-size:11px" :disabled="disputeActionId === d.id" @click.stop="dashOutcome(d, 'won')">Won</button>
            <button class="btn btn-sm btn-secondary" style="padding:3px 12px;font-size:11px" :disabled="disputeActionId === d.id" @click.stop="dashOutcome(d, 'lost')">Lost</button>
          </template>
          <template v-else>
            <span class="text-sm text-muted">Submitted to the bank?</span>
            <button class="btn btn-sm btn-primary" style="padding:3px 12px;font-size:11px" :disabled="disputeActionId === d.id" @click.stop="dashSubmit(d)">Mark Submitted</button>
          </template>
        </div>
      </div>
    </div>

    <!-- Pulse check-ins: the merchant must see client pulse responses here, in the
         app — especially ones flagged as needing attention — not only via email. -->
    <div class="card mb-4" v-if="pulseCheckins.length > 0">
      <SectionHeader :title="['Pulse', 'check-ins.']">
        <template #actions>
          <span v-if="pulseAttentionCount > 0" class="badge badge-red">
            {{ pulseAttentionCount }} need{{ pulseAttentionCount === 1 ? 's' : '' }} attention
          </span>
        </template>
      </SectionHeader>
      <div v-for="pc in pulseCheckins.slice(0, 5)" :key="pc.id" class="flex-between mb-4" style="gap:12px;flex-wrap:wrap;cursor:pointer" @click="$router.push(`/clients/${pc.contactId}`)">
        <div style="min-width:0">
          <div class="text-sm">
            <strong>{{ pc.contactName || 'Unknown client' }}</strong>
            <span v-if="pc.offerName" class="text-muted" style="margin-left:8px">{{ pc.offerName }}</span>
            <span v-else-if="!pc.linked" class="badge badge-yellow" style="margin-left:8px">Not linked to a program — review</span>
            <span v-if="pc.needsAttention" class="badge badge-red" style="margin-left:8px">⚠ {{ pc.attentionReason }}</span>
          </div>
          <div v-if="pc.feedback" class="text-sm text-muted" style="max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            {{ pc.feedback }}
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-shrink:0">
          <span v-if="pc.satisfaction !== null" class="badge" :class="pc.satisfaction <= 2 ? 'badge-red' : pc.satisfaction === 3 ? 'badge-yellow' : 'badge-green'">
            {{ pc.satisfaction }}/5
          </span>
          <span class="text-sm text-muted">{{ formatTimestamp(pc.submittedAt) }}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card" v-if="data">
        <SectionHeader :title="['Defense', 'activity.']" />
        <div class="mt-2">
          <div class="flex-between mb-4">
            <span class="text-sm">Pending</span>
            <span class="badge badge-yellow">{{ data.defenseStats.pending }}</span>
          </div>
          <div class="flex-between mb-4">
            <span class="text-sm">Processing</span>
            <span class="badge badge-blue">{{ data.defenseStats.processing }}</span>
          </div>
          <div class="flex-between mb-4">
            <span class="text-sm">Complete</span>
            <span class="badge badge-green">{{ data.defenseStats.complete }}</span>
          </div>
          <div class="flex-between">
            <span class="text-sm">Failed</span>
            <span class="badge badge-red">{{ data.defenseStats.failed }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <SectionHeader :title="['At-risk', 'clients.']">
          <template #actions>
            <router-link to="/clients" class="btn btn-sm btn-secondary">View All</router-link>
          </template>
        </SectionHeader>
        <div v-if="atRisk && atRisk.length > 0">
          <div v-for="client in atRisk.slice(0, 5)" :key="client.contactId" class="flex-between mb-4">
            <div>
              <div class="text-sm">{{ client.contactId }}</div>
              <div class="text-sm text-muted">{{ client.riskFactors[0] }}</div>
            </div>
            <span class="badge badge-red">Risk: {{ client.riskScore }}</span>
          </div>
        </div>
        <EmptyState
          v-else
          :icon="ShieldCheck"
          title="No at-risk clients detected"
          body="When chargeback signals appear, at-risk clients will surface here for follow-up."
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-vue-next';
import { useApi } from '../composables/useApi';
import SectionHeader from '../components/SectionHeader.vue';
import Stat from '../components/Stat.vue';
import EmptyState from '../components/EmptyState.vue';
import Pill from '../components/Pill.vue';
import Skeleton from '../components/Skeleton.vue';
import { formatTimestamp, parseDateValue } from '../utils/humanize';

const REFRESH_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 2 * 60_000;
const TICK_INTERVAL_MS = 30_000;

const api = useApi();
const { loading, error } = api;

const data = ref<any>(null);
const atRisk = ref<any[]>([]);
const defensePackets = ref<any[]>([]);
const pulseCheckins = ref<any[]>([]);
const pulseAttentionCount = ref(0);
// Open Stripe disputes with NO defense packet (contact couldn't be matched) —
// invisible in the packet list, so they must be surfaced here.
const unmatchedDisputes = ref<any[]>([]);

// Deadline urgency: everything due within 3 days (packets + unmatched disputes)
const dueSoonCount = computed(() => {
  const cutoff = Date.now() + 3 * 86400000;
  const packetCount = openDisputes.value.filter((p) => {
    if ((p.lifecycleStatus || p.lifecycle_status) === 'submitted') return false;
    const deadline = p.deadline || p.response_deadline;
    return deadline && parseDateValue(deadline).getTime() <= cutoff;
  }).length;
  const unmatchedCount = unmatchedDisputes.value.filter((d) =>
    d.evidence_due_by && new Date(d.evidence_due_by).getTime() <= cutoff,
  ).length;
  return packetCount + unmatchedCount;
});

// Open disputes = the merchant's action queue: ready-but-unsubmitted packets
// (deadline not yet passed) and submitted packets awaiting an outcome.
const openDisputes = computed(() => {
  return defensePackets.value
    .filter((p) => {
      const lifecycle = p.lifecycleStatus || p.lifecycle_status || 'pending_submission';
      if (lifecycle === 'submitted') return !p.outcome;
      if (lifecycle !== 'pending_submission') return false;
      if (!['complete', 'needs_review'].includes(p.status)) return false;
      const deadline = p.deadline || p.response_deadline;
      if (deadline && parseDateValue(deadline).getTime() < Date.now() - 86400000) return false; // expired
      return true;
    })
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);
});

const disputeActionId = ref('');
async function dashSubmit(d: any) {
  if (!window.confirm('Mark this packet as submitted to the bank? This locks the letter — you won\'t be able to edit or regenerate it afterwards.')) return;
  disputeActionId.value = d.id;
  try {
    await api.post(`/api/defense/${d.id}/submit`, {});
    await loadData();
  } catch { /* useApi toasts */ }
  disputeActionId.value = '';
}

async function dashOutcome(d: any, outcome: 'won' | 'lost') {
  const amount = `$${Number(d.dispute_amount || 0).toFixed(2)}`;
  if (!window.confirm(`Mark the ${amount} chargeback for ${d.contactName || 'this client'} as ${outcome.toUpperCase()}?`)) return;
  disputeActionId.value = d.id;
  try {
    await api.post(`/api/defense/${d.id}/outcome`, { outcome });
    await loadData();
  } catch { /* useApi toasts */ }
  disputeActionId.value = '';
}
const lastUpdatedAt = ref<Date | null>(null);
const refreshing = ref(false);
const tickNow = ref(new Date());

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

const isStale = computed(() => {
  if (!lastUpdatedAt.value) return false;
  return tickNow.value.getTime() - lastUpdatedAt.value.getTime() > STALE_THRESHOLD_MS;
});

async function loadData() {
  if (refreshing.value) return;
  refreshing.value = true;
  const overviewPromise = api.get<any>('/api/dashboard/overview');
  const riskPromise = api.get<any>('/api/dashboard/at-risk')
    .then((risk) => ({ ok: true, risk }))
    .catch(() => ({ ok: false, risk: null }));
  const defensePromise = api.get<any>('/api/dashboard/defense-history')
    .then((d) => ({ ok: true, packets: d?.packets || [], unmatched: d?.unmatchedDisputes || [] }))
    .catch(() => ({ ok: false, packets: [] as any[], unmatched: [] as any[] }));
  const pulsePromise = api.get<any>('/api/dashboard/pulse-checkins?limit=10')
    .then((p) => ({ ok: true, checkins: p?.checkins || [], attentionCount: p?.attentionCount || 0 }))
    .catch(() => ({ ok: false, checkins: [] as any[], attentionCount: 0 }));

  try {
    const overview = await overviewPromise;
    data.value = overview;
    lastUpdatedAt.value = new Date();
    tickNow.value = new Date();
  } catch {
    // useApi already surfaces error.value; keep stale data on screen.
  }

  try {
    const riskResult = await riskPromise;
    if (riskResult.ok) {
      atRisk.value = riskResult.risk.clients || [];
    }
    const defenseResult = await defensePromise;
    if (defenseResult.ok) {
      defensePackets.value = defenseResult.packets;
      unmatchedDisputes.value = defenseResult.unmatched;
    }
    const pulseResult = await pulsePromise;
    if (pulseResult.ok) {
      pulseCheckins.value = pulseResult.checkins;
      pulseAttentionCount.value = pulseResult.attentionCount;
    }
  } catch {
    // Keep the dashboard stats visible if the risk scan fails.
  } finally {
    refreshing.value = false;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(loadData, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // Refresh immediately on return so "stale" state doesn't linger after a long sleep.
    loadData();
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

onMounted(() => {
  loadData();
  startAutoRefresh();
  tickTimer = setInterval(() => { tickNow.value = new Date(); }, TICK_INTERVAL_MS);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  stopAutoRefresh();
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<style scoped>
.dashboard-updated-line {
  font-size: 12px;
  color: var(--ss-navy-500);
  margin: -8px 0 16px 0;
}
.dashboard-skeleton-rows {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
</style>
