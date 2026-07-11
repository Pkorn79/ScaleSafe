<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Activity, AlertTriangle, BarChart3, BookOpen, CalendarDays, Check, CheckCircle2,
  ChevronRight, Clock3, FileCheck2, FolderOpen, KeyRound, Link2, MessageSquare,
  Plug, RefreshCw, Search, ShieldCheck, Users, Workflow, X,
} from 'lucide-vue-next';
import SectionHeader from '../components/SectionHeader.vue';
import Modal from '../components/Modal.vue';
import { useApi } from '../composables/useApi';

interface ConnectionSummary {
  id: string;
  name: string;
  status: string;
  setupStatus: string;
  healthStatus: string;
  externalAccountName: string | null;
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
}

interface Provider {
  key: string;
  name: string;
  category: string;
  wave: number;
  authMode: string;
  capabilities: string[];
  summary: string;
  releaseStatus: string;
  releasedForTenant: boolean;
  connectable: boolean;
  connected: boolean;
  hasConnection: boolean;
  connections: ConnectionSummary[];
}

interface ConnectionStatus {
  id: string;
  name: string;
  source: string;
  providerKey: string | null;
  connectionType: string;
  setupStatus: string;
  healthStatus: string;
  lastEvidenceAt: string | null;
  lastEventAt: string | null;
  publishedCount: number;
  affectedPrograms: Array<{ offerId: string; offerName: string }>;
  needsAttention: boolean;
  statusMessage: string | null;
}

const api = useApi();
const providers = ref<Provider[]>([]);
const connections = ref<ConnectionStatus[]>([]);
const selectedConnection = ref<ConnectionStatus | null>(null);
const events = ref<any[]>([]);
const loading = ref(false);
const query = ref('');
const category = ref('all');
const connectOpen = ref(false);
const connectProvider = ref<Provider | null>(null);
const connectionName = ref('');
const connecting = ref(false);
const credentialResult = ref<any | null>(null);
const zoomSetup = ref<any | null>(null);
const zoomSelections = ref<Record<string, string>>({});
const savingMappings = ref(false);
let oauthPopup: Window | null = null;

const categories = [
  ['all', 'All'],
  ['course_community', 'Courses'],
  ['meetings_scheduling', 'Meetings'],
  ['agency_delivery', 'Agency delivery'],
  ['communication_support', 'Support'],
  ['files_deliverables', 'Files'],
  ['checkout_enrollment', 'Checkout'],
  ['reporting_outcomes', 'Reporting'],
  ['advanced', 'Advanced'],
];

const visibleProviders = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return providers.value.filter((provider) => {
    if (category.value !== 'all' && provider.category !== category.value) return false;
    return !needle || `${provider.name} ${provider.summary} ${provider.capabilities.join(' ')}`.toLowerCase().includes(needle);
  });
});

const connectedItems = computed(() => providers.value.flatMap((provider) => {
  if (provider.key === 'ghl_native') return [{ provider, connection: null as ConnectionSummary | null }];
  return provider.connections.map((connection) => ({ provider, connection }));
}));

function categoryIcon(value: string) {
  return ({
    native: ShieldCheck,
    course_community: BookOpen,
    meetings_scheduling: CalendarDays,
    agency_delivery: Workflow,
    communication_support: MessageSquare,
    files_deliverables: FolderOpen,
    checkout_enrollment: KeyRound,
    reporting_outcomes: BarChart3,
    advanced: Plug,
  } as Record<string, any>)[value] || Plug;
}

function capabilityLabel(value: string) {
  return ({
    evidence: 'Evidence', attendance: 'Attendance', progress: 'Progress', attachments: 'Files',
    communications: 'Communication', native_purchases: 'Purchases', access_management: 'Access', reporting: 'Reporting',
  } as Record<string, string>)[value] || value;
}

function releaseLabel(provider: Provider) {
  if (provider.connected) return 'Connected';
  if (provider.hasConnection) return 'Setup needed';
  return ({
    native: 'Native', available: 'Available', beta: 'Beta', guided: 'Guided setup',
    planned: `Wave ${provider.wave}`, discovery: 'Research', disabled: 'Unavailable',
  } as Record<string, string>)[provider.releaseStatus] || 'Planned';
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'No activity yet';
}

async function load() {
  loading.value = true;
  try {
    const [catalogResult, connectionResult] = await Promise.all([
      api.get<any>('/api/evidence-connections/catalog'),
      api.get<any>('/api/evidence-connections'),
    ]);
    providers.value = catalogResult.providers || [];
    connections.value = connectionResult.connections || [];
    if (selectedConnection.value) {
      selectedConnection.value = connections.value.find((item) => item.id === selectedConnection.value?.id) || null;
    }
  } finally {
    loading.value = false;
  }
}

async function openConnection(id: string) {
  selectedConnection.value = connections.value.find((connection) => connection.id === id) || null;
  if (!selectedConnection.value) return;
  const result = await api.get<any>(`/api/evidence-connections/${id}/events`);
  events.value = result.events || [];
  zoomSetup.value = null;
  zoomSelections.value = {};
  if (selectedConnection.value.providerKey === 'zoom') {
    zoomSetup.value = await api.get<any>(`/api/evidence-connections/${id}/zoom-setup`);
    for (const resource of zoomSetup.value.resources || []) {
      zoomSelections.value[resource.id] = resource.mapping?.offer_id || resource.suggestedOfferId || '';
    }
  }
}

function beginConnect(provider: Provider) {
  connectProvider.value = provider;
  connectionName.value = provider.name === 'Custom Software API' ? 'Custom Software' : provider.name;
  credentialResult.value = null;
  connectOpen.value = true;
}

async function createConnection() {
  if (!connectProvider.value) return;
  connecting.value = true;
  try {
    if (connectProvider.value.authMode === 'oauth2') {
      oauthPopup = window.open('', 'scalesafe_provider_oauth', 'width=620,height=760');
      const result = await api.post<any>(
        `/api/evidence-connections/catalog/${connectProvider.value.key}/connect`,
        { name: connectionName.value },
      );
      if (!oauthPopup) throw new Error('Allow popups to connect this account');
      oauthPopup.location.href = result.authorizationUrl;
      return;
    }
    credentialResult.value = await api.post<any>(
      `/api/evidence-connections/catalog/${connectProvider.value.key}/connect`,
      { name: connectionName.value },
    );
    await load();
  } finally {
    connecting.value = false;
  }
}

async function saveZoomMappings() {
  if (!selectedConnection.value || !zoomSetup.value) return;
  savingMappings.value = true;
  try {
    await api.post(`/api/evidence-connections/${selectedConnection.value.id}/zoom-mappings`, {
      mappings: (zoomSetup.value.resources || []).map((resource: any) => ({
        resourceId: resource.id,
        offerId: zoomSelections.value[resource.id] || '',
      })),
    });
    await load();
    await openConnection(selectedConnection.value.id);
  } finally {
    savingMappings.value = false;
  }
}

async function handleOAuthMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin || event.data?.type !== 'zoom_connect_result') return;
  oauthPopup = null;
  if (!event.data.success) return;
  connectOpen.value = false;
  await load();
  const zoom = providers.value.find((provider) => provider.key === 'zoom');
  const connection = zoom?.connections[0];
  if (connection) await openConnection(connection.id);
}

async function disableConnection() {
  if (!selectedConnection.value) return;
  await api.post(`/api/evidence-connections/${selectedConnection.value.id}/status`, { enabled: false });
  selectedConnection.value = null;
  events.value = [];
  await load();
}

onMounted(() => {
  window.addEventListener('message', handleOAuthMessage);
  load();
});
onBeforeUnmount(() => window.removeEventListener('message', handleOAuthMessage));
</script>

<template>
  <div class="connections-page">
    <SectionHeader eyebrow="Settings" :title="['Evidence', 'connections.']" description="" />

    <section class="connected-band">
      <div class="section-title">
        <div><h2>Connected</h2><span>{{ connectedItems.length }} source{{ connectedItems.length === 1 ? '' : 's' }}</span></div>
        <button class="icon-button" title="Refresh connections" :disabled="loading" @click="load">
          <RefreshCw :size="17" :class="{ spinning: loading }" />
        </button>
      </div>
      <div class="connected-grid">
        <button
          v-for="item in connectedItems"
          :key="item.connection?.id || item.provider.key"
          class="connected-row"
          :disabled="!item.connection"
          @click="item.connection && openConnection(item.connection.id)"
        >
          <span class="provider-icon"><component :is="categoryIcon(item.provider.category)" :size="19" /></span>
          <span class="connected-copy"><strong>{{ item.connection?.name || item.provider.name }}</strong><small>{{ item.connection?.externalAccountName || (item.provider.key === 'ghl_native' ? 'Native' : item.provider.name) }}</small></span>
          <span class="health-dot" :class="{ warning: item.connection && ['warning', 'error'].includes(item.connection.healthStatus) }" />
          <ChevronRight v-if="item.connection" :size="17" />
          <CheckCircle2 v-else :size="17" />
        </button>
      </div>
    </section>

    <section class="catalog-band">
      <div class="catalog-head">
        <h2>Integration catalog</h2>
        <label class="search-box">
          <Search :size="16" />
          <input v-model="query" type="search" placeholder="Search platforms" />
          <button v-if="query" title="Clear search" @click="query = ''"><X :size="14" /></button>
        </label>
      </div>

      <div class="category-tabs" role="tablist" aria-label="Integration categories">
        <button v-for="item in categories" :key="item[0]" :class="{ active: category === item[0] }" @click="category = item[0]">{{ item[1] }}</button>
      </div>

      <div class="catalog-grid">
        <article v-for="provider in visibleProviders" :key="provider.key" class="provider-card">
          <header>
            <span class="provider-icon"><component :is="categoryIcon(provider.category)" :size="19" /></span>
            <div><h3>{{ provider.name }}</h3><span class="release" :class="provider.releaseStatus">{{ releaseLabel(provider) }}</span></div>
          </header>
          <p>{{ provider.summary }}</p>
          <div class="capabilities">
            <span v-for="capability in provider.capabilities" :key="capability"><Check :size="12" />{{ capabilityLabel(capability) }}</span>
          </div>
          <button v-if="provider.connectable" class="connect-button" @click="beginConnect(provider)">
            <Plug :size="15" /> Connect
          </button>
          <button v-else-if="provider.connected" class="connected-button" disabled><CheckCircle2 :size="15" /> Connected</button>
          <div v-else class="availability"><Clock3 :size="14" />{{ releaseLabel(provider) }}</div>
        </article>
        <div v-if="!visibleProviders.length" class="no-results">No matching integrations</div>
      </div>
    </section>

    <Modal v-model:open="connectOpen" :title="`Connect ${connectProvider?.name || 'platform'}`">
      <div v-if="!credentialResult" class="connect-form">
        <label>Connection name<input v-model="connectionName" maxlength="120" /></label>
        <div class="modal-actions"><button class="secondary-button" @click="connectOpen = false">Cancel</button><button class="primary-button" :disabled="connecting || !connectionName.trim()" @click="createConnection"><Plug :size="15" />{{ connecting ? 'Connecting...' : (connectProvider?.authMode === 'oauth2' ? `Connect ${connectProvider?.name}` : 'Create connection') }}</button></div>
      </div>
      <div v-else class="credential-panel">
        <ShieldCheck :size="24" />
        <strong>Credential created</strong>
        <span>API key</span><code>{{ credentialResult.credential?.secret }}</code>
        <span>Endpoint</span><code>{{ credentialResult.endpoints?.canonicalUrl }}</code>
        <p>This key is shown once.</p>
        <button class="primary-button" @click="connectOpen = false"><Check :size="15" /> Done</button>
      </div>
    </Modal>

    <Modal :open="Boolean(selectedConnection)" :title="selectedConnection?.name || 'Connection'" max-width="720px" @update:open="value => { if (!value) selectedConnection = null }">
      <div v-if="selectedConnection" class="connection-detail">
        <div class="detail-status" :class="{ warning: selectedConnection.needsAttention }">
          <AlertTriangle v-if="selectedConnection.needsAttention" :size="18" />
          <CheckCircle2 v-else :size="18" />
          <span>{{ selectedConnection.needsAttention ? selectedConnection.statusMessage || 'Needs attention' : 'Connection healthy' }}</span>
        </div>
        <div class="metrics">
          <div><span>Last evidence</span><strong>{{ formatDate(selectedConnection.lastEvidenceAt) }}</strong></div>
          <div><span>Published</span><strong>{{ selectedConnection.publishedCount }}</strong></div>
          <div><span>Programs</span><strong>{{ selectedConnection.affectedPrograms.length }}</strong></div>
        </div>
        <div v-if="selectedConnection.providerKey === 'zoom' && zoomSetup" class="zoom-mapping">
          <div class="mapping-head">
            <div><h3>Meeting matches</h3><p>Match each client-facing Zoom meeting to the ScaleSafe offer it delivers.</p></div>
            <span>{{ zoomSetup.connection?.externalAccountName }}</span>
          </div>
          <div v-for="resource in zoomSetup.resources" :key="resource.id" class="mapping-row">
            <div><strong>{{ resource.name }}</strong><small>{{ resource.metadata?.hostName || resource.metadata?.hostEmail || 'Zoom host' }} · Meeting {{ resource.id }}</small></div>
            <select v-model="zoomSelections[resource.id]">
              <option value="">Do not collect</option>
              <option v-for="offer in zoomSetup.offers" :key="offer.id" :value="offer.id">{{ offer.offer_name }}</option>
            </select>
          </div>
          <div v-if="!zoomSetup.resources.length" class="empty-cell">No scheduled meetings were returned by Zoom.</div>
          <div class="mapping-actions">
            <span>Attendance only. Zoom chats are not collected.</span>
            <button class="primary-button" :disabled="savingMappings" @click="saveZoomMappings"><Check :size="15" />{{ savingMappings ? 'Saving...' : 'Save and activate' }}</button>
          </div>
        </div>
        <h3>Recent activity</h3>
        <table><thead><tr><th>Received</th><th>Activity</th><th>Program</th><th>Status</th></tr></thead><tbody>
          <tr v-for="event in events" :key="event.id"><td>{{ formatDate(event.receivedAt) }}</td><td>{{ event.eventType }}</td><td>{{ event.target?.offerName || 'Resolving' }}</td><td>{{ event.isTest ? 'Test only' : event.status }}</td></tr>
          <tr v-if="!events.length"><td colspan="4" class="empty-cell">No recent activity</td></tr>
        </tbody></table>
        <div class="detail-actions"><button class="danger-button" @click="disableConnection">Disable connection</button></div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.connections-page{max-width:1180px}.connected-band,.catalog-band{padding:18px 0;border-top:1px solid #e2e8f0}.section-title,.catalog-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.section-title>div{display:flex;align-items:baseline;gap:10px}.section-title h2,.catalog-head h2{font-size:16px;margin:0}.section-title span{font-size:12px;color:#64748b}.icon-button{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;background:#fff;border-radius:6px;color:#334155;cursor:pointer}.icon-button:disabled{opacity:.55}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.connected-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.connected-row{display:grid;grid-template-columns:38px minmax(0,1fr) 8px 18px;align-items:center;gap:10px;text-align:left;border:1px solid #dbe3ea;background:#fff;padding:10px;border-radius:6px;color:#0f172a;cursor:pointer}.connected-row:hover{border-color:#94a3b8}.provider-icon{width:38px;height:38px;display:inline-flex;align-items:center;justify-content:center;background:#f1f5f9;color:#334155;border-radius:6px;flex:0 0 auto}.connected-copy{display:flex;flex-direction:column;min-width:0}.connected-copy strong,.connected-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.connected-copy small{font-size:11px;color:#64748b}.health-dot{width:8px;height:8px;border-radius:50%;background:#16a34a}.health-dot.warning{background:#d97706}.search-box{width:min(320px,100%);height:38px;display:flex;align-items:center;gap:8px;border:1px solid #cbd5e1;background:#fff;padding:0 10px;border-radius:6px}.search-box input{width:100%;border:0;outline:0;font:inherit;font-size:13px}.search-box button{border:0;background:transparent;padding:3px;display:flex;cursor:pointer}.category-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid #e2e8f0;margin-bottom:16px}.category-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:9px 11px;font-size:12px;color:#64748b;white-space:nowrap;cursor:pointer}.category-tabs button.active{color:#0f766e;border-color:#0f766e;font-weight:700}.catalog-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.provider-card{display:flex;flex-direction:column;min-height:220px;border:1px solid #dbe3ea;background:#fff;border-radius:6px;padding:14px}.provider-card header{display:flex;gap:10px;align-items:flex-start}.provider-card h3{font-size:14px;margin:1px 0 5px;letter-spacing:0}.release{display:inline-block;font-size:10px;font-weight:700;color:#475569;background:#f1f5f9;padding:2px 6px;border-radius:4px}.release.available,.release.native,.release.beta{color:#166534;background:#dcfce7}.release.guided{color:#92400e;background:#fef3c7}.provider-card p{font-size:12px;line-height:1.45;color:#475569;margin:12px 0}.capabilities{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px}.capabilities span{display:inline-flex;align-items:center;gap:3px;font-size:10px;color:#475569;border:1px solid #e2e8f0;padding:3px 5px;border-radius:4px}.connect-button,.connected-button,.primary-button,.secondary-button,.danger-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer}.connect-button,.primary-button{margin-top:auto;border:1px solid #0f766e;background:#0f766e;color:#fff;padding:7px 12px}.connected-button{margin-top:auto;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;padding:7px 12px}.availability{margin-top:auto;display:flex;align-items:center;gap:5px;color:#64748b;font-size:11px;padding:9px 0}.no-results{grid-column:1/-1;text-align:center;padding:40px;color:#64748b}.connect-form label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700}.connect-form input{height:40px;border:1px solid #cbd5e1;border-radius:6px;padding:0 10px}.modal-actions,.detail-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.secondary-button{border:1px solid #cbd5e1;background:#fff;color:#334155;padding:7px 12px}.danger-button{border:1px solid #fecaca;background:#fff;color:#b91c1c;padding:7px 12px}.credential-panel{display:flex;flex-direction:column;gap:8px}.credential-panel>span{font-size:10px;text-transform:uppercase;color:#64748b;margin-top:6px}.credential-panel code{display:block;overflow-wrap:anywhere;background:#f8fafc;border:1px solid #e2e8f0;padding:9px;border-radius:4px;font-size:11px}.credential-panel p{font-size:12px;color:#b45309}.credential-panel .primary-button{align-self:flex-end;margin-top:8px}.detail-status{display:flex;align-items:center;gap:8px;padding:10px;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}.detail-status.warning{background:#fffbeb;color:#92400e;border-color:#fde68a}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:14px 0;border:1px solid #e2e8f0}.metrics div{padding:10px;border-right:1px solid #e2e8f0}.metrics div:last-child{border:0}.metrics span{display:block;font-size:9px;text-transform:uppercase;color:#64748b}.metrics strong{font-size:12px}.connection-detail h3{font-size:13px;margin:18px 0 8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0;font-size:11px}th{font-size:9px;text-transform:uppercase;color:#64748b}.empty-cell{text-align:center;color:#94a3b8;padding:24px}@media(max-width:980px){.connected-grid,.catalog-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.section-title,.catalog-head{align-items:stretch;flex-direction:column}.search-box{width:auto}.connected-grid,.catalog-grid{grid-template-columns:1fr}.metrics{grid-template-columns:1fr}.metrics div{border-right:0;border-bottom:1px solid #e2e8f0}.metrics div:last-child{border-bottom:0}}
.zoom-mapping{border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:4px 0 14px;margin:16px 0}.mapping-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.mapping-head h3{margin-bottom:3px}.mapping-head p{font-size:11px;color:#64748b;margin:0}.mapping-head>span{font-size:10px;color:#475569;background:#f1f5f9;padding:4px 6px;border-radius:4px}.mapping-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,42%);align-items:center;gap:12px;padding:9px 0;border-top:1px solid #f1f5f9}.mapping-row>div{display:flex;flex-direction:column;min-width:0}.mapping-row strong,.mapping-row small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mapping-row strong{font-size:12px}.mapping-row small{font-size:10px;color:#64748b}.mapping-row select{height:36px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;padding:0 8px;font-size:11px}.mapping-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.mapping-actions>span{font-size:10px;color:#64748b}.mapping-actions .primary-button{margin-top:0}@media(max-width:640px){.mapping-row{grid-template-columns:1fr}.mapping-actions{align-items:stretch;flex-direction:column}}
</style>
