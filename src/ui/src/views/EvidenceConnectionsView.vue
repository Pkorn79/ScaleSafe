<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Copy, KeyRound, Plus, RefreshCw, Send, Unplug, X } from 'lucide-vue-next';
import SectionHeader from '../components/SectionHeader.vue';
import { useApi } from '../composables/useApi';
import { toast } from '../composables/useToast';

interface ResourceMapping {
  resource_type?: string;
  resourceType?: string;
  external_resource_id?: string;
  externalResourceId?: string;
  external_resource_name?: string;
  externalResourceName?: string;
  offer_id?: string;
  offerId?: string;
  offer?: { offer_name?: string };
}

interface Connection {
  id: string;
  public_id: string;
  name: string;
  source_label: string;
  connection_type: 'canonical_api' | 'raw_webhook' | 'legacy_external';
  status: string;
  health_status: string;
  mapping_config: Record<string, any>;
  allowed_attachment_domains: string[];
  rate_limit_per_minute: number;
  last_event_at: string | null;
  last_success_at: string | null;
  last_error_message: string | null;
  endpoints: { canonicalUrl: string; webhookUrl: string };
  mappings: ResourceMapping[];
}

interface Subject {
  enrollmentId: string;
  enrollmentRef: string;
  email: string;
  offerName: string;
  status: string;
}

const api = useApi();
const connections = ref<Connection[]>([]);
const offers = ref<any[]>([]);
const subjects = ref<Subject[]>([]);
const events = ref<any[]>([]);
const selectedId = ref('');
const showCreate = ref(false);
const working = ref(false);
const issuedSecret = ref<{ secret: string; endpoint: string; type: string } | null>(null);
const previewPayload = ref('');
const previewResult = ref<any>(null);
const testEnrollmentId = ref('');

const form = reactive({
  name: '',
  sourceLabel: '',
  connectionType: 'canonical_api' as 'canonical_api' | 'raw_webhook',
  credentialType: 'api_key',
  allowedDomains: '',
  eventIdPath: 'id',
  eventTypePath: 'event',
  occurredAtPath: 'occurred_at',
  enrollmentRefPath: 'metadata.scalesafe_enrollment_ref',
  contactEmailPath: 'contact.email',
  externalContactIdPath: 'contact.id',
  externalEnrollmentIdPath: 'enrollment.id',
  resourceTypePath: 'resource.type',
  resourceIdPath: 'resource.id',
  resourceNamePath: 'resource.name',
});

const selected = computed(() => connections.value.find((item) => item.id === selectedId.value) || null);
const mappingRows = ref<Array<{ resourceType: string; externalResourceId: string; externalResourceName: string; offerId: string }>>([]);

async function load() {
  const [connectionResult, offerResult, subjectResult] = await Promise.all([
    api.get<any>('/api/evidence-connections'),
    api.get<any>('/api/offers'),
    api.get<any>('/api/evidence-connections/subjects'),
  ]);
  connections.value = connectionResult.connections || [];
  offers.value = Array.isArray(offerResult) ? offerResult : offerResult.offers || [];
  subjects.value = subjectResult.subjects || [];
  if (!selectedId.value && connections.value[0]) selectConnection(connections.value[0].id);
  else if (selectedId.value) selectConnection(selectedId.value, false);
}

async function selectConnection(id: string, fetchEvents = true) {
  selectedId.value = id;
  const connection = connections.value.find((item) => item.id === id);
  mappingRows.value = (connection?.mappings || []).map((row) => ({
    resourceType: row.resource_type || row.resourceType || '',
    externalResourceId: row.external_resource_id || row.externalResourceId || '',
    externalResourceName: row.external_resource_name || row.externalResourceName || '',
    offerId: row.offer_id || row.offerId || '',
  }));
  previewResult.value = null;
  if (fetchEvents) {
    const result = await api.get<any>(`/api/evidence-connections/${id}/events`);
    events.value = result.events || [];
  }
}

function resetForm() {
  form.name = '';
  form.sourceLabel = '';
  form.connectionType = 'canonical_api';
  form.credentialType = 'api_key';
  form.allowedDomains = '';
  showCreate.value = false;
}

function mappingConfig() {
  return {
    eventIdPath: form.eventIdPath,
    eventTypePath: form.eventTypePath,
    occurredAtPath: form.occurredAtPath,
    enrollmentRefPath: form.enrollmentRefPath || undefined,
    contactEmailPath: form.contactEmailPath || undefined,
    externalContactIdPath: form.externalContactIdPath || undefined,
    externalEnrollmentIdPath: form.externalEnrollmentIdPath || undefined,
    resourceTypePath: form.resourceTypePath || undefined,
    resourceIdPath: form.resourceIdPath || undefined,
    resourceNamePath: form.resourceNamePath || undefined,
    actorTypeValue: 'provider',
    activity: {},
    approvedCustomTypes: [],
  };
}

async function createConnection() {
  working.value = true;
  try {
    const result = await api.post<any>('/api/evidence-connections', {
      name: form.name,
      sourceLabel: form.sourceLabel || form.name,
      connectionType: form.connectionType,
      credentialType: form.credentialType,
      mappingConfig: form.connectionType === 'raw_webhook' ? mappingConfig() : undefined,
      allowedAttachmentDomains: form.allowedDomains.split(',').map((item) => item.trim()).filter(Boolean),
    });
    issuedSecret.value = {
      secret: result.credential.secret,
      endpoint: form.connectionType === 'canonical_api' ? result.endpoints.canonicalUrl : result.endpoints.webhookUrl,
      type: result.credential.type,
    };
    resetForm();
    await load();
    selectedId.value = result.connection.id;
    await selectConnection(result.connection.id);
    toast.success('Evidence connection created.');
  } finally { working.value = false; }
}

async function rotateCredential() {
  if (!selected.value || !confirm('Rotate this connection credential? The current credential will expire in 24 hours.')) return;
  working.value = true;
  try {
    const result = await api.post<any>(`/api/evidence-connections/${selected.value.id}/rotate`, { graceHours: 24 });
    issuedSecret.value = {
      secret: result.credential.secret,
      endpoint: selected.value.connection_type === 'canonical_api' ? result.endpoints.canonicalUrl : result.endpoints.webhookUrl,
      type: result.credential.type,
    };
    toast.success('Credential rotated.');
  } finally { working.value = false; }
}

async function toggleConnection() {
  if (!selected.value) return;
  const enabled = selected.value.status !== 'active';
  await api.post(`/api/evidence-connections/${selected.value.id}/status`, { enabled });
  await load();
  toast.success(enabled ? 'Connection enabled.' : 'Connection disabled.');
}

async function saveMappings() {
  if (!selected.value) return;
  working.value = true;
  try {
    await api.put(`/api/evidence-connections/${selected.value.id}`, { resourceMappings: mappingRows.value });
    await load();
    toast.success('Resource mappings saved.');
  } finally { working.value = false; }
}

async function previewMapping() {
  if (!selected.value) return;
  try {
    const payload = JSON.parse(previewPayload.value);
    previewResult.value = await api.post(`/api/evidence-connections/${selected.value.id}/preview`, { payload });
  } catch (err: any) {
    previewResult.value = { valid: false, errors: [err.message] };
  }
}

async function sendTest() {
  if (!selected.value || !testEnrollmentId.value) return;
  await api.post(`/api/evidence-connections/${selected.value.id}/test`, { enrollmentId: testEnrollmentId.value });
  toast.success('Connector test accepted.');
  setTimeout(() => selectConnection(selected.value!.id), 1500);
}

function addMapping() {
  mappingRows.value.push({ resourceType: '', externalResourceId: '', externalResourceName: '', offerId: '' });
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success('Copied.');
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

onMounted(load);
</script>

<template>
  <div>
    <SectionHeader eyebrow="Settings" :title="['Evidence', 'connections.']" description="" />

    <div class="toolbar">
      <div class="status-line">{{ connections.length }} connection{{ connections.length === 1 ? '' : 's' }}</div>
      <button class="btn btn-primary" @click="showCreate = true"><Plus :size="16" /> New Connection</button>
    </div>

    <div v-if="issuedSecret" class="credential-panel">
      <div>
        <strong>New {{ issuedSecret.type.replace('_', ' ') }}</strong>
        <div class="mono secret-value">{{ issuedSecret.secret }}</div>
        <div class="mono endpoint-value">{{ issuedSecret.endpoint }}</div>
      </div>
      <div class="credential-actions">
        <button class="icon-button" title="Copy credential" @click="copy(issuedSecret.secret)"><KeyRound :size="17" /></button>
        <button class="icon-button" title="Copy endpoint" @click="copy(issuedSecret.endpoint)"><Copy :size="17" /></button>
        <button class="icon-button" title="Dismiss" @click="issuedSecret = null"><X :size="17" /></button>
      </div>
    </div>

    <div v-if="showCreate" class="setup-band">
      <div class="setup-head"><h2>New Evidence Connection</h2><button class="icon-button" title="Close" @click="showCreate = false"><X :size="17" /></button></div>
      <div class="grid grid-2">
        <div class="form-group"><label class="form-label">Connection Name</label><input class="form-input" v-model="form.name" /></div>
        <div class="form-group"><label class="form-label">Source Label</label><input class="form-input" v-model="form.sourceLabel" /></div>
        <div class="form-group"><label class="form-label">Connection Type</label><select class="form-select" v-model="form.connectionType"><option value="canonical_api">Canonical API</option><option value="raw_webhook">Raw Webhook</option></select></div>
        <div class="form-group"><label class="form-label">Authentication</label><select class="form-select" v-model="form.credentialType"><option value="api_key">API Key</option><option v-if="form.connectionType === 'raw_webhook'" value="url_secret">Secret URL</option><option v-if="form.connectionType === 'raw_webhook'" value="hmac">HMAC</option></select></div>
      </div>
      <div class="form-group"><label class="form-label">Approved Attachment Domains</label><input class="form-input" v-model="form.allowedDomains" placeholder="files.example.com, cdn.example.com" /></div>
      <div v-if="form.connectionType === 'raw_webhook'" class="mapping-grid">
        <div class="form-group"><label class="form-label">Event ID Path</label><input class="form-input mono" v-model="form.eventIdPath" /></div>
        <div class="form-group"><label class="form-label">Event Type Path</label><input class="form-input mono" v-model="form.eventTypePath" /></div>
        <div class="form-group"><label class="form-label">Occurred At Path</label><input class="form-input mono" v-model="form.occurredAtPath" /></div>
        <div class="form-group"><label class="form-label">Enrollment Reference Path</label><input class="form-input mono" v-model="form.enrollmentRefPath" /></div>
        <div class="form-group"><label class="form-label">Contact Email Path</label><input class="form-input mono" v-model="form.contactEmailPath" /></div>
        <div class="form-group"><label class="form-label">External Contact ID Path</label><input class="form-input mono" v-model="form.externalContactIdPath" /></div>
        <div class="form-group"><label class="form-label">External Enrollment ID Path</label><input class="form-input mono" v-model="form.externalEnrollmentIdPath" /></div>
        <div class="form-group"><label class="form-label">Resource Type Path</label><input class="form-input mono" v-model="form.resourceTypePath" /></div>
        <div class="form-group"><label class="form-label">Resource ID Path</label><input class="form-input mono" v-model="form.resourceIdPath" /></div>
        <div class="form-group"><label class="form-label">Resource Name Path</label><input class="form-input mono" v-model="form.resourceNamePath" /></div>
      </div>
      <button class="btn btn-primary" :disabled="working || !form.name" @click="createConnection">Create Connection</button>
    </div>

    <div class="connections-layout">
      <div class="connection-list">
        <button v-for="item in connections" :key="item.id" class="connection-row" :class="{ selected: selectedId === item.id }" @click="selectConnection(item.id)">
          <span><strong>{{ item.name }}</strong><small>{{ item.connection_type.replace('_', ' ') }}</small></span>
          <span class="health" :class="item.health_status">{{ item.health_status }}</span>
        </button>
        <div v-if="!connections.length" class="empty-state">No evidence connections</div>
      </div>

      <div v-if="selected" class="connection-detail">
        <div class="detail-head">
          <div><h2>{{ selected.name }}</h2><div class="muted">{{ selected.source_label }} | {{ selected.status }}</div></div>
          <div class="detail-actions">
            <button class="icon-button" title="Rotate credential" :disabled="working" @click="rotateCredential"><RefreshCw :size="17" /></button>
            <button class="icon-button danger" :title="selected.status === 'active' ? 'Disable connection' : 'Enable connection'" @click="toggleConnection"><Unplug :size="17" /></button>
          </div>
        </div>

        <div class="metrics">
          <div><span>Health</span><strong>{{ selected.health_status }}</strong></div>
          <div><span>Last event</span><strong>{{ formatDate(selected.last_event_at) }}</strong></div>
          <div><span>Last success</span><strong>{{ formatDate(selected.last_success_at) }}</strong></div>
        </div>
        <div v-if="selected.last_error_message" class="error-msg">{{ selected.last_error_message }}</div>

        <section>
          <h3>Resource Mappings</h3>
          <div v-for="(row, index) in mappingRows" :key="index" class="mapping-row">
            <input class="form-input" v-model="row.resourceType" placeholder="Resource type" />
            <input class="form-input" v-model="row.externalResourceId" placeholder="External resource ID" />
            <input class="form-input" v-model="row.externalResourceName" placeholder="Resource name" />
            <select class="form-select" v-model="row.offerId"><option value="">Select offer</option><option v-for="offer in offers" :key="offer.id" :value="offer.id">{{ offer.offer_name }}</option></select>
            <button class="icon-button" title="Remove mapping" @click="mappingRows.splice(index, 1)"><X :size="16" /></button>
          </div>
          <div class="row-actions"><button class="btn btn-secondary btn-sm" @click="addMapping"><Plus :size="14" /> Mapping</button><button class="btn btn-primary btn-sm" :disabled="working" @click="saveMappings">Save</button></div>
        </section>

        <section v-if="selected.connection_type === 'raw_webhook'">
          <h3>Mapping Preview</h3>
          <textarea class="form-textarea mono" v-model="previewPayload" rows="6" placeholder="Paste a sample JSON payload"></textarea>
          <button class="btn btn-secondary btn-sm" @click="previewMapping">Preview</button>
          <pre v-if="previewResult" class="preview-output">{{ JSON.stringify(previewResult, null, 2) }}</pre>
        </section>

        <section>
          <h3>Connection Test</h3>
          <div class="test-row"><select class="form-select" v-model="testEnrollmentId"><option value="">Select enrollment</option><option v-for="subject in subjects" :key="subject.enrollmentId" :value="subject.enrollmentId">{{ subject.offerName }} | {{ subject.email }}</option></select><button class="btn btn-secondary" :disabled="!testEnrollmentId" @click="sendTest"><Send :size="15" /> Test</button></div>
        </section>

        <section>
          <h3>Recent Events</h3>
          <table><thead><tr><th>Received</th><th>Event</th><th>Status</th><th>Resolution</th></tr></thead><tbody><tr v-for="event in events" :key="event.id"><td>{{ formatDate(event.receivedAt) }}</td><td>{{ event.eventType }}<small v-if="event.isTest">Test</small></td><td>{{ event.status }}</td><td>{{ event.resolutionMethod || event.errorCode || 'Pending' }}</td></tr><tr v-if="!events.length"><td colspan="4" class="empty-cell">No events</td></tr></tbody></table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar,.setup-head,.detail-head,.detail-actions,.row-actions,.credential-panel,.credential-actions,.test-row{display:flex;align-items:center}.toolbar,.setup-head,.detail-head,.credential-panel{justify-content:space-between}.toolbar{margin-bottom:16px}.status-line,.muted{color:var(--ss-navy-500);font-size:13px}.credential-panel{background:#ecfdf5;border:1px solid #a7f3d0;padding:14px 16px;border-radius:8px;margin-bottom:16px;gap:16px}.secret-value{font-weight:700;color:#065f46;margin-top:6px}.endpoint-value{font-size:12px;color:#475569;margin-top:4px;word-break:break-all}.credential-actions,.detail-actions,.row-actions{gap:8px}.icon-button{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;background:#fff;border-radius:6px;color:#334155;cursor:pointer}.icon-button:hover{background:#f8fafc}.icon-button.danger{color:#b91c1c}.setup-band{background:#fff;border:1px solid var(--ss-navy-200);padding:20px;margin-bottom:18px}.setup-head h2,.detail-head h2{font-size:18px}.mapping-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.connections-layout{display:grid;grid-template-columns:minmax(230px,280px) minmax(0,1fr);gap:18px}.connection-list{border-right:1px solid #e2e8f0;padding-right:14px}.connection-row{width:100%;display:flex;justify-content:space-between;align-items:center;text-align:left;border:1px solid transparent;background:transparent;padding:12px;margin-bottom:6px;cursor:pointer}.connection-row.selected{background:#fff;border-color:#cbd5e1}.connection-row span:first-child{display:flex;flex-direction:column;gap:3px}.connection-row small,td small{font-size:11px;color:#64748b;display:block}.health{font-size:11px;text-transform:capitalize;padding:3px 7px;border-radius:999px;background:#f1f5f9}.health.healthy{background:#dcfce7;color:#166534}.health.warning{background:#fef3c7;color:#92400e}.health.error{background:#fee2e2;color:#991b1b}.connection-detail{min-width:0}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:16px 0}.metrics div{padding:12px 16px;border-right:1px solid #e2e8f0}.metrics div:last-child{border-right:0}.metrics span{display:block;font-size:11px;text-transform:uppercase;color:#64748b;margin-bottom:4px}.metrics strong{font-size:13px}section{padding:18px 0;border-bottom:1px solid #e2e8f0}section h3{font-size:14px;margin-bottom:10px}.mapping-row{display:grid;grid-template-columns:1fr 1.2fr 1.2fr 1.3fr 38px;gap:8px;margin-bottom:8px}.row-actions{justify-content:flex-end}.test-row{gap:8px;max-width:680px}.form-textarea{width:100%;border:1px solid #cbd5e1;padding:10px;resize:vertical}.preview-output{margin-top:10px;padding:12px;background:#0f172a;color:#e2e8f0;overflow:auto;font-size:11px;max-height:320px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e2e8f0;font-size:12px}th{font-size:10px;text-transform:uppercase;color:#64748b}.empty-state,.empty-cell{padding:24px;text-align:center;color:#94a3b8}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:900px){.connections-layout{grid-template-columns:1fr}.connection-list{border-right:0;border-bottom:1px solid #e2e8f0;padding:0 0 12px}.mapping-grid,.metrics{grid-template-columns:1fr}.mapping-row{grid-template-columns:1fr}.test-row{align-items:stretch;flex-direction:column}}
</style>
