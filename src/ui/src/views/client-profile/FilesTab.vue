<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Files</div>
    </div>

    <div v-if="loading" class="loading">Loading files...</div>
    <div v-else-if="error" class="error-msg">{{ error }}</div>

    <template v-else>
      <!-- Enrollment packets -->
      <div class="card">
        <div class="card-title">Enrollment Packets</div>
        <div v-if="packets.length === 0" class="text-sm text-muted" style="margin-top:8px">
          No enrollment packets yet.
        </div>
        <table v-else class="table" style="margin-top:8px">
          <thead>
            <tr>
              <th>Program</th>
              <th>Generated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in packets" :key="p.enrollmentId">
              <td>
                <strong>{{ p.offerName || 'Enrollment Packet' }}</strong>
              </td>
              <td class="text-sm">{{ formatDate(p.createdAt) }}</td>
              <td>
                <button class="btn btn-sm btn-secondary" @click="downloadPacket(p.enrollmentId)" :disabled="downloadingId === p.enrollmentId">
                  {{ downloadingId === p.enrollmentId ? '...' : 'Download' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Signed milestones -->
      <div class="card">
        <div class="card-title">Signed Milestones</div>
        <div v-if="signoffs.length === 0" class="text-sm text-muted" style="margin-top:8px">
          No signed milestones yet.
        </div>
        <table v-else class="table" style="margin-top:8px">
          <thead>
            <tr>
              <th>Milestone</th>
              <th>Signed</th>
              <th>Signed By</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in signoffs" :key="i">
              <td>
                <strong>#{{ s.milestoneNumber }}: {{ s.milestoneName || '—' }}</strong>
              </td>
              <td class="text-sm">{{ formatDate(s.signedAt) }}</td>
              <td class="text-sm">{{ s.signedBy || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  contactId: string;
}>();

const api = useApi();

const packets = ref<any[]>([]);
const signoffs = ref<any[]>([]);
const loading = ref(false);
const error = ref('');
const downloadingId = ref<string | null>(null);

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function downloadPacket(enrollmentId: string) {
  downloadingId.value = enrollmentId;
  try {
    const headers: Record<string, string> = {};
    const payload = sessionStorage.getItem('ss_sso_payload');
    if (payload) headers['x-sso-payload'] = payload;
    else {
      const loc = sessionStorage.getItem('ss_location_id');
      if (loc) headers['x-location-id'] = loc;
    }
    const res = await fetch(`/api/enrollments/${enrollmentId}/packet?download=true`, { headers });
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-packet-${enrollmentId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e: any) {
    error.value = e.message || 'Download failed';
  }
  downloadingId.value = null;
}

onMounted(async () => {
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get<any>(`/api/dashboard/client-files/${props.contactId}`);
    packets.value = result?.packets || [];
    signoffs.value = result?.signoffs || [];
  } catch (e: any) {
    error.value = e.message || 'Failed to load files';
  }
  loading.value = false;
});
</script>
