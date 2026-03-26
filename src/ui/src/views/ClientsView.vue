<template>
  <div>
    <h1 class="page-title">Clients & Evidence Health</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading client data...</div>

    <div v-if="healthData" class="grid grid-3 mb-4">
      <div class="card">
        <div class="card-title">Total Clients</div>
        <div class="card-value">{{ healthData.totalClients }}</div>
      </div>
      <div class="card">
        <div class="card-title">Avg Readiness Score</div>
        <div class="card-value" :style="{ color: scoreColor(healthData.averageScore) }">
          {{ healthData.averageScore }}/100
        </div>
      </div>
      <div class="card">
        <div class="card-title">At-Risk Clients</div>
        <div class="card-value" style="color: #ef4444">{{ atRiskCount }}</div>
      </div>
    </div>

    <div class="card" v-if="healthData && healthData.scores.length > 0">
      <div class="card-title mb-4">Defense Readiness Scores</div>
      <table class="table">
        <thead>
          <tr>
            <th>Contact ID</th>
            <th>Score</th>
            <th>Consent</th>
            <th>Payments</th>
            <th>Delivery</th>
            <th>Engagement</th>
            <th>Recency</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="client in healthData.scores" :key="client.contactId">
            <td>
              <router-link :to="`/clients/${client.contactId}`" style="color:#3b82f6;text-decoration:none">
                {{ client.contactId.slice(0, 12) }}...
              </router-link>
            </td>
            <td>
              <div class="flex gap-2" style="align-items:center">
                <strong :style="{ color: scoreColor(client.score) }">{{ client.score }}</strong>
                <div class="score-bar" style="width:60px">
                  <div class="score-fill" :style="{ width: client.score + '%', background: scoreColor(client.score) }"></div>
                </div>
              </div>
            </td>
            <td>{{ client.breakdown.consent?.points || 0 }}/{{ client.breakdown.consent?.max || 20 }}</td>
            <td>{{ client.breakdown.payments?.points || 0 }}/{{ client.breakdown.payments?.max || 15 }}</td>
            <td>{{ client.breakdown.delivery?.points || 0 }}/{{ client.breakdown.delivery?.max || 25 }}</td>
            <td>{{ client.breakdown.engagement?.points || 0 }}/{{ client.breakdown.engagement?.max || 20 }}</td>
            <td>{{ client.breakdown.recency?.points || 0 }}/{{ client.breakdown.recency?.max || 10 }}</td>
            <td>
              <router-link :to="`/clients/${client.contactId}`" class="btn btn-sm btn-secondary">View</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="healthData && healthData.scores.length === 0 && !loading" class="empty-state">
      <p>No client evidence recorded yet.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useApi } from '../composables/useApi';

const api = useApi();
const { loading, error } = api;
const healthData = ref<any>(null);
const atRiskCount = ref(0);

function scoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

onMounted(async () => {
  try {
    const [health, risk] = await Promise.all([
      api.get<any>('/api/dashboard/evidence-health'),
      api.get<any>('/api/dashboard/at-risk'),
    ]);
    healthData.value = health;
    atRiskCount.value = risk.count || 0;
  } catch {}
});
</script>
