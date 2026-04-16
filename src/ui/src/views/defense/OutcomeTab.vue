<template>
  <div>
    <div class="card-title mb-4">Dispute Outcome</div>

    <!-- Show existing outcome if already recorded -->
    <div v-if="hasOutcome" class="card">
      <div class="flex gap-4" style="align-items:center">
        <span class="badge" :class="outcomeBadge" style="font-size:16px;padding:6px 14px">
          {{ outcomeDisplay }}
        </span>
        <div v-if="amountRecovered" class="text-sm">
          <strong>Amount Recovered:</strong> ${{ Number(amountRecovered).toFixed(2) }}
        </div>
      </div>
      <div v-if="resolvedAt" class="text-sm text-muted mt-2">
        Decision date: {{ formatDate(resolvedAt) }}
      </div>
      <div v-if="notes" class="text-sm mt-2" style="white-space:pre-wrap">{{ notes }}</div>
    </div>

    <!-- Gated: only show the form if submitted and no outcome yet -->
    <div v-else-if="lifecycleStatus === 'submitted'" class="card">
      <p class="text-sm text-muted mb-4">
        Record the processor's decision once you receive it. This typically takes 30-90 days after submission.
      </p>

      <div class="flex gap-2 mb-4">
        <button class="btn" :class="selectedOutcome === 'won' ? 'btn-success' : 'btn-secondary'" @click="selectedOutcome = 'won'">Won</button>
        <button class="btn" :class="selectedOutcome === 'lost' ? 'btn-danger' : 'btn-secondary'" @click="selectedOutcome = 'lost'">Lost</button>
        <button class="btn" :class="selectedOutcome === 'withdrawn' ? 'btn-secondary' : 'btn-secondary'" style="opacity:0.7" @click="selectedOutcome = 'withdrawn'">Withdrawn</button>
      </div>

      <div v-if="selectedOutcome === 'won'" class="form-group">
        <label class="form-label">Amount Recovered ($)</label>
        <input class="form-input" type="number" step="0.01" v-model.number="form.amountRecovered" :placeholder="String(disputeAmount)" />
      </div>

      <div class="form-group">
        <label class="form-label">Decision Date</label>
        <input class="form-input" type="date" v-model="form.resolvedAt" />
      </div>

      <div class="form-group">
        <label class="form-label">Notes (optional)</label>
        <textarea class="form-textarea" v-model="form.notes" rows="3" placeholder="Bank notes, reference numbers, etc."></textarea>
      </div>

      <div v-if="error" class="error-msg mb-4">{{ error }}</div>

      <button class="btn btn-primary" @click="submitOutcome" :disabled="!selectedOutcome || saving">
        {{ saving ? 'Saving...' : 'Record Outcome' }}
      </button>
    </div>

    <!-- Not yet submitted -->
    <div v-else class="text-sm text-muted">
      Mark the defense as submitted before recording an outcome. Outcomes are typically available 30-90 days after submission.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  defenseId: string;
  lifecycleStatus: string;
  disputeAmount: number;
  existingOutcome?: { outcome: string; amount_saved?: number; resolved_at?: string; notes?: string } | null;
}>();

const emit = defineEmits<{
  (e: 'outcome-recorded'): void;
}>();

const api = useApi();
const selectedOutcome = ref<'won' | 'lost' | 'withdrawn' | ''>('');
const saving = ref(false);
const error = ref('');

const form = ref({
  amountRecovered: props.disputeAmount || 0,
  resolvedAt: new Date().toISOString().split('T')[0],
  notes: '',
});

const hasOutcome = computed(() => !!props.existingOutcome);
const outcomeDisplay = computed(() => {
  const o = props.existingOutcome?.outcome;
  if (o === 'won') return 'Won';
  if (o === 'lost') return 'Lost';
  if (o === 'withdrawn') return 'Withdrawn';
  return o || '';
});
const outcomeBadge = computed(() => {
  const o = props.existingOutcome?.outcome;
  if (o === 'won') return 'badge-green';
  if (o === 'lost') return 'badge-red';
  return 'badge-gray';
});
const amountRecovered = computed(() => props.existingOutcome?.amount_saved);
const resolvedAt = computed(() => props.existingOutcome?.resolved_at);
const notes = computed(() => props.existingOutcome?.notes);

function formatDate(d: string): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function submitOutcome() {
  if (!selectedOutcome.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api.post(`/api/defense/${props.defenseId}/outcome`, {
      outcome: selectedOutcome.value,
      amountRecovered: selectedOutcome.value === 'won' ? form.value.amountRecovered : undefined,
      resolvedAt: form.value.resolvedAt || undefined,
      notes: form.value.notes || undefined,
    });
    emit('outcome-recorded');
  } catch (e: any) {
    error.value = e.message || 'Failed to record outcome';
  }
  saving.value = false;
}
</script>
