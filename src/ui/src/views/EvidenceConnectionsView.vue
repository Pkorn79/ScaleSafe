<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Activity, AlertTriangle, CheckCircle2, Link2, RefreshCw } from 'lucide-vue-next';
import SectionHeader from '../components/SectionHeader.vue';
import { useApi } from '../composables/useApi';

interface ProgramSummary {
  offerId: string;
  offerName: string;
}

interface ConnectionStatus {
  id: string;
  name: string;
  source: string;
  connectionType: string;
  status: string;
  setupStatus: string;
  healthStatus: string;
  lastEvidenceAt: string | null;
  lastEventAt: string | null;
  publishedCount: number;
  affectedPrograms: ProgramSummary[];
  needsAttention: boolean;
  statusMessage: string | null;
}

const api = useApi();
const connections = ref<ConnectionStatus[]>([]);
const selectedId = ref('');
const events = ref<any[]>([]);
const loading = ref(false);

const selected = computed(() => connections.value.find((connection) => connection.id === selectedId.value) || null);

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'No evidence received yet';
}

function sourceLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

async function selectConnection(id: string) {
  selectedId.value = id;
  const result = await api.get<any>(`/api/evidence-connections/${id}/events`);
  events.value = result.events || [];
}

async function load() {
  loading.value = true;
  try {
    const result = await api.get<any>('/api/evidence-connections');
    connections.value = result.connections || [];
    const nextId = selectedId.value && connections.value.some((connection) => connection.id === selectedId.value)
      ? selectedId.value
      : connections.value[0]?.id || '';
    if (nextId) await selectConnection(nextId);
    else events.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <SectionHeader eyebrow="Settings" :title="['Evidence', 'connections.']" description="" />

    <div class="toolbar">
      <span>{{ connections.length }} connected source{{ connections.length === 1 ? '' : 's' }}</span>
      <button class="icon-button" title="Refresh connection status" :disabled="loading" @click="load">
        <RefreshCw :size="17" :class="{ spinning: loading }" />
      </button>
    </div>

    <div v-if="!connections.length" class="empty-state">
      <Link2 :size="24" />
      <strong>No evidence sources connected</strong>
      <span>Your ScaleSafe setup team will configure supported sources for this account.</span>
    </div>

    <div v-else class="layout">
      <nav class="source-list" aria-label="Evidence sources">
        <button
          v-for="connection in connections"
          :key="connection.id"
          class="source-row"
          :class="{ selected: connection.id === selectedId }"
          @click="selectConnection(connection.id)"
        >
          <span class="source-copy">
            <strong>{{ connection.name }}</strong>
            <small>{{ connection.source }}</small>
          </span>
          <AlertTriangle v-if="connection.needsAttention" :size="17" class="warning-icon" />
          <CheckCircle2 v-else :size="17" class="healthy-icon" />
        </button>
      </nav>

      <main v-if="selected" class="detail">
        <header class="detail-header">
          <div>
            <h2>{{ selected.name }}</h2>
            <p>{{ sourceLabel(selected.connectionType) }} · {{ sourceLabel(selected.healthStatus) }}</p>
          </div>
          <span class="status-pill" :class="{ warning: selected.needsAttention }">
            {{ selected.needsAttention ? 'Needs Attention' : 'Connected' }}
          </span>
        </header>

        <div v-if="selected.needsAttention" class="attention-band">
          <AlertTriangle :size="18" />
          <span>{{ selected.statusMessage || 'This connection needs attention from the ScaleSafe setup team.' }}</span>
        </div>

        <section class="metrics">
          <div><span>Last evidence</span><strong>{{ formatDate(selected.lastEvidenceAt) }}</strong></div>
          <div><span>Published events</span><strong>{{ selected.publishedCount }}</strong></div>
          <div><span>Programs receiving evidence</span><strong>{{ selected.affectedPrograms.length }}</strong></div>
        </section>

        <section>
          <h3>Programs</h3>
          <div v-if="selected.affectedPrograms.length" class="program-list">
            <span v-for="program in selected.affectedPrograms" :key="program.offerId">{{ program.offerName }}</span>
          </div>
          <p v-else class="muted">No program evidence has been published from this source yet.</p>
        </section>

        <section>
          <h3>Recent evidence activity</h3>
          <table>
            <thead><tr><th>Received</th><th>Activity</th><th>Program</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="event in events" :key="event.id">
                <td>{{ formatDate(event.receivedAt) }}</td>
                <td>{{ sourceLabel(event.eventType) }}<small v-if="event.isTest">Connection test</small></td>
                <td>{{ event.target?.offerName || 'Resolving' }}</td>
                <td>{{ event.isTest ? 'Test only' : sourceLabel(event.status) }}</td>
              </tr>
              <tr v-if="!events.length"><td colspan="4" class="empty-cell">No recent activity</td></tr>
            </tbody>
          </table>
        </section>

        <div class="managed-note">
          <Activity :size="17" />
          <span>Connection setup and mapping are managed by the ScaleSafe team.</span>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.toolbar,.detail-header,.managed-note,.attention-band{display:flex;align-items:center}.toolbar{justify-content:space-between;color:var(--ss-navy-500);font-size:13px;margin-bottom:16px}.icon-button{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;background:#fff;border-radius:6px;color:#334155;cursor:pointer}.icon-button:disabled{opacity:.55;cursor:default}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.empty-state{min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px solid #e2e8f0;background:#fff;color:#64748b}.empty-state strong{color:#0f172a}.layout{display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:18px}.source-list{border-right:1px solid #e2e8f0;padding-right:14px}.source-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;border:1px solid transparent;background:transparent;padding:12px;margin-bottom:6px;cursor:pointer}.source-row.selected{background:#fff;border-color:#cbd5e1}.source-copy{display:flex;flex-direction:column;gap:3px;min-width:0}.source-copy strong,.source-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-copy small{font-size:11px;color:#64748b}.warning-icon{color:#b45309}.healthy-icon{color:#15803d}.detail{min-width:0}.detail-header{justify-content:space-between;gap:12px}.detail-header h2{font-size:18px;margin:0}.detail-header p{font-size:12px;color:#64748b;margin:4px 0 0}.status-pill{font-size:11px;font-weight:700;padding:4px 8px;border-radius:999px;background:#dcfce7;color:#166534}.status-pill.warning{background:#fef3c7;color:#92400e}.attention-band{gap:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:12px 14px;margin-top:14px;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:16px 0}.metrics div{padding:12px 16px;border-right:1px solid #e2e8f0}.metrics div:last-child{border-right:0}.metrics span{display:block;font-size:10px;text-transform:uppercase;color:#64748b;margin-bottom:4px}.metrics strong{font-size:13px}section{padding:16px 0;border-bottom:1px solid #e2e8f0}section h3{font-size:14px;margin:0 0 10px}.program-list{display:flex;flex-wrap:wrap;gap:6px}.program-list span{font-size:12px;border:1px solid #cbd5e1;background:#fff;padding:5px 8px;border-radius:4px}.muted{color:#64748b;font-size:13px}.managed-note{gap:8px;color:#64748b;font-size:12px;padding:14px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e2e8f0;font-size:12px}th{font-size:10px;text-transform:uppercase;color:#64748b}td small{display:block;color:#64748b;font-size:10px}.empty-cell{text-align:center;color:#94a3b8;padding:24px}@media(max-width:900px){.layout{grid-template-columns:1fr}.source-list{border-right:0;border-bottom:1px solid #e2e8f0;padding:0 0 12px}.metrics{grid-template-columns:1fr}.metrics div{border-right:0;border-bottom:1px solid #e2e8f0}.metrics div:last-child{border-bottom:0}}
</style>
