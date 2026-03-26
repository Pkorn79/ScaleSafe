<template>
  <div>
    <h1 class="page-title">Dashboard</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading dashboard...</div>

    <div v-if="data" class="grid grid-4 mb-4">
      <div class="card">
        <div class="card-title">Active Offers</div>
        <div class="card-value">{{ data.activeOffers }}</div>
      </div>
      <div class="card">
        <div class="card-title">Active Clients</div>
        <div class="card-value">{{ data.activeClients }}</div>
      </div>
      <div class="card">
        <div class="card-title">Evidence Records</div>
        <div class="card-value">{{ data.totalEvidenceRecords.toLocaleString() }}</div>
      </div>
      <div class="card">
        <div class="card-title">Total Value Saved</div>
        <div class="card-value" style="color: #10b981">${{ data.totalValueSaved.toLocaleString() }}</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card" v-if="data">
        <div class="card-title">Defense Activity</div>
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
        <div class="flex-between mb-4">
          <div class="card-title">At-Risk Clients</div>
          <router-link to="/clients" class="btn btn-sm btn-secondary">View All</router-link>
        </div>
        <div v-if="atRisk && atRisk.length > 0">
          <div v-for="client in atRisk.slice(0, 5)" :key="client.contactId" class="flex-between mb-4">
            <div>
              <div class="text-sm">{{ client.contactId }}</div>
              <div class="text-sm text-muted">{{ client.riskFactors[0] }}</div>
            </div>
            <span class="badge badge-red">Risk: {{ client.riskScore }}</span>
          </div>
        </div>
        <div v-else class="text-sm text-muted mt-2">No at-risk clients detected</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';

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
