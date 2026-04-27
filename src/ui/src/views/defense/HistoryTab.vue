<template>
  <div>
    <div class="card-title mb-4">Letter Version History</div>

    <div v-if="loading" class="loading">Loading versions...</div>
    <div v-else-if="versions.length === 0" class="text-sm text-muted">No letter generated yet.</div>

    <div v-for="v in versions" :key="v.id" class="version-card" :class="{ 'version-submitted': v.is_submitted_version }">
      <div class="flex-between">
        <div>
          <strong>Version {{ v.version_number }}</strong>
          <span class="badge" :class="v.generated_by === 'ai' ? 'badge-blue' : 'badge-yellow'" style="margin-left:8px">
            {{ v.generated_by === 'ai' ? 'AI Generated' : 'Manual Edit' }}
          </span>
          <span v-if="v.is_submitted_version" class="badge badge-green" style="margin-left:4px">Submitted</span>
        </div>
        <span class="text-sm text-muted">{{ formatDate(v.generated_at) }}</span>
      </div>
      <!-- Model name + token counts intentionally hidden from merchant view. Available via API for support diagnostics. -->
      <div v-if="expandedVersion === v.id" class="version-preview">
        {{ v.letter_text }}
      </div>
      <button class="btn btn-sm btn-secondary mt-2" @click="expandedVersion = expandedVersion === v.id ? null : v.id">
        {{ expandedVersion === v.id ? 'Collapse' : 'View Letter' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  defenseId: string;
}>();

const api = useApi();
const versions = ref<any[]>([]);
const loading = ref(false);
const expandedVersion = ref<string | null>(null);

function formatDate(d: string): string {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

onMounted(async () => {
  loading.value = true;
  try {
    versions.value = await api.get<any[]>(`/api/defense/${props.defenseId}/versions`) || [];
  } catch {}
  loading.value = false;
});
</script>

<style scoped>
.version-card {
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 10px;
}

.version-submitted {
  border-color: #10b981;
  border-width: 2px;
}

.version-preview {
  margin-top: 10px;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
}
</style>
