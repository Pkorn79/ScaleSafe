<template>
  <div>
    <SectionHeader
      eyebrow="Overview"
      :title="['Your', 'dashboard.']"
      description="Real-time view of active offers, clients, evidence captured, and chargeback defense activity."
    />

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading dashboard...</div>

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
        label="Total Value Saved"
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
import { ref, onMounted } from 'vue';
import { ShieldCheck } from 'lucide-vue-next';
import { useApi } from '../composables/useApi';
import SectionHeader from '../components/SectionHeader.vue';
import Stat from '../components/Stat.vue';
import EmptyState from '../components/EmptyState.vue';

const api = useApi();
const { loading, error } = api;

const data = ref<any>(null);
const atRisk = ref<any[]>([]);

onMounted(async () => {
  try {
    const [overview, risk] = await Promise.all([
      api.get<any>('/api/dashboard/overview'),
      api.get<any>('/api/dashboard/at-risk'),
    ]);
    data.value = overview;
    atRisk.value = risk.clients || [];
  } catch {}
});
</script>
