<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Defense Packet</h1>
      <router-link to="/defense" class="btn btn-secondary">Back</router-link>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading defense packet...</div>

    <div v-if="packet">
      <!-- Status + Metadata -->
      <div class="grid grid-4 mb-4">
        <div class="card">
          <div class="card-title">Status</div>
          <span class="badge" :class="statusBadge(packet.status)" style="font-size:14px">{{ packet.status }}</span>
        </div>
        <div class="card">
          <div class="card-title">Reason Code</div>
          <div class="card-value" style="font-size:20px">{{ packet.reason_code }}</div>
          <div class="text-sm text-muted">{{ packet.reason_category }}</div>
        </div>
        <div class="card">
          <div class="card-title">Dispute Amount</div>
          <div class="card-value" style="font-size:20px">${{ packet.dispute_amount }}</div>
        </div>
        <div class="card">
          <div class="card-title">Deadline</div>
          <div style="font-size:16px;font-weight:600;color:#ef4444">{{ formatDate(packet.deadline) }}</div>
        </div>
      </div>

      <!-- Defense Letter -->
      <div v-if="packet.defense_letter_text" class="card mb-4">
        <div class="flex-between mb-4">
          <div class="card-title">Defense Letter</div>
          <div class="text-sm text-muted">
            Tokens: {{ packet.input_tokens }} in / {{ packet.output_tokens }} out
          </div>
        </div>
        <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:500px;overflow-y:auto;padding:12px;background:#f9fafb;border-radius:6px">{{ packet.defense_letter_text }}</div>
      </div>

      <div v-if="packet.status === 'processing'" class="card mb-4">
        <div class="text-sm text-muted" style="text-align:center;padding:20px">
          Defense letter is being compiled by AI. This may take 1-2 minutes.
          <br /><br />
          <button class="btn btn-sm btn-secondary" @click="refresh">Refresh Status</button>
        </div>
      </div>

      <!-- Record Outcome -->
      <div v-if="packet.status === 'complete'" class="card">
        <div class="card-title mb-4">Record Outcome</div>
        <div class="flex gap-2">
          <button class="btn btn-success" @click="recordOutcome('won')" :disabled="recording">
            {{ recording ? '...' : 'Won' }}
          </button>
          <button class="btn btn-danger" @click="recordOutcome('lost')" :disabled="recording">
            {{ recording ? '...' : 'Lost' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';

const route = useRoute();
const api = useApi();
const { loading, error } = api;

const packet = ref<any>(null);
const recording = ref(false);

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-yellow', processing: 'badge-blue',
    complete: 'badge-green', failed: 'badge-red',
  };
  return map[status] || 'badge-gray';
}

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function refresh() {
  try {
    packet.value = await api.get<any>(`/api/defense/${route.params.id}`);
  } catch {}
}

async function recordOutcome(outcome: 'won' | 'lost') {
  recording.value = true;
  try {
    await api.post(`/api/defense/${route.params.id}/outcome`, { outcome });
    await refresh();
  } catch {}
  recording.value = false;
}

onMounted(refresh);
</script>
