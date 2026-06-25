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
import { formatTimestamp } from '../utils/humanize';

const REFRESH_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 2 * 60_000;
const TICK_INTERVAL_MS = 30_000;

const api = useApi();
const { loading, error } = api;

const data = ref<any>(null);
const atRisk = ref<any[]>([]);
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
