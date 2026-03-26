<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Client: {{ contactId.slice(0, 16) }}...</h1>
      <router-link to="/clients" class="btn btn-secondary">Back</router-link>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Readiness Score -->
    <div v-if="score" class="card mb-4">
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

    <!-- Evidence Timeline -->
    <div class="card">
      <div class="card-title mb-4">Evidence Timeline ({{ timeline.length }} records)</div>

      <div v-if="loading" class="loading">Loading timeline...</div>

      <div v-if="timeline.length === 0 && !loading" class="empty-state">
        <p>No evidence recorded for this client.</p>
      </div>

      <table v-if="timeline.length > 0" class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Source</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in timeline" :key="i">
            <td class="text-sm">{{ formatDate(item.event_date || item.created_at) }}</td>
            <td>
              <span class="badge badge-blue">{{ item.evidence_type }}</span>
            </td>
            <td class="text-sm text-muted">{{ item.source || '-' }}</td>
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
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function summarize(item: any): string {
  const d = item.summary || item.details;
  if (typeof d === 'string') return d.slice(0, 100);
  if (typeof d === 'object' && d) return JSON.stringify(d).slice(0, 100);
  return '-';
}

onMounted(async () => {
  try {
    const [s, t] = await Promise.all([
      api.get<any>(`/api/evidence/${contactId.value}/score`),
      api.get<any[]>(`/api/evidence/${contactId.value}`),
    ]);
    score.value = s;
    timeline.value = t;
  } catch {}
});
</script>
