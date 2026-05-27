<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Communications</div>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-secondary" @click="$emit('add-note')">Add Note</button>
        <button class="btn btn-sm btn-primary" @click="$emit('send-message')">Send Message</button>
      </div>
    </div>

    <div v-if="loading && items.length === 0" class="loading">Loading communications...</div>
    <div v-else-if="error" class="error-msg">{{ error }}</div>
    <EmptyState
      v-else-if="items.length === 0"
      :icon="MessageSquare"
      title="No communications yet"
      body="Notes and messages between you and this client will appear here. Send a message or log a note to start the trail."
      cta-label="Send Message"
      @cta-click="$emit('send-message')"
    />

    <div v-else class="card">
      <div v-for="(item, i) in items" :key="i" class="comm-row">
        <div class="comm-meta">
          <span class="badge" :class="channelBadge(item.channel)">{{ channelLabel(item.channel) }}</span>
          <span v-if="item.direction === 'inbound'" class="badge badge-gray" style="margin-left:4px">Inbound</span>
          <span v-else-if="item.direction === 'outbound'" class="badge badge-gray" style="margin-left:4px">Outbound</span>
          <span v-if="item.sourceMark === 'automated'" class="badge badge-blue" style="margin-left:4px" title="Sent by ScaleSafe">Automated</span>
          <span v-else-if="item.sourceMark === 'ghl'" class="badge badge-blue" style="margin-left:4px" title="Captured from GHL">GHL</span>
          <span v-else-if="item.sourceMark === 'manual'" class="badge badge-gray" style="margin-left:4px" title="Sent manually in GHL">Manual</span>
          <span v-if="item.natureLabel" class="badge badge-gray" style="margin-left:4px">{{ item.natureLabel }}</span>
          <span class="text-sm text-muted" style="margin-left:auto">{{ formatDate(item.date) }}</span>
        </div>
        <div v-if="item.subject" class="comm-subject">{{ item.subject }}</div>
        <div class="comm-body">{{ item.body }}</div>
      </div>

      <div v-if="hasMore" class="text-sm mt-4" style="text-align:center">
        <button class="btn btn-sm btn-secondary" @click="loadMore" :disabled="loading">
          {{ loading ? 'Loading...' : 'Load older' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { MessageSquare } from 'lucide-vue-next';
import { useApi } from '../../composables/useApi';
import EmptyState from '../../components/EmptyState.vue';

const props = defineProps<{
  contactId: string;
}>();

defineEmits<{
  (e: 'add-note'): void;
  (e: 'send-message'): void;
}>();

const api = useApi();

interface CommItem {
  id: string;
  channel: string;     // 'email' | 'sms' | 'call' | 'note' | 'other'
  direction: 'inbound' | 'outbound' | 'note';
  date: string;
  body: string;
  subject?: string;
  natureLabel?: string;
  sourceMark?: 'manual' | 'automated' | 'ghl' | null;
}

const items = ref<CommItem[]>([]);
const loading = ref(false);
const error = ref('');
const hasMore = ref(false);
const offset = ref(0);
const pageSize = 50;

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function channelLabel(ch: string): string {
  if (!ch) return 'Other';
  if (ch === 'email') return 'Email';
  if (ch === 'sms') return 'SMS';
  if (ch === 'call') return 'Call';
  if (ch === 'note') return 'Note';
  return ch.charAt(0).toUpperCase() + ch.slice(1);
}

function channelBadge(ch: string): string {
  if (ch === 'email') return 'badge-blue';
  if (ch === 'sms') return 'badge-green';
  if (ch === 'call') return 'badge-yellow';
  if (ch === 'note') return 'badge-gray';
  return 'badge-gray';
}

async function fetchPage(off: number, append: boolean) {
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get<any>(
      `/api/dashboard/client-communications/${props.contactId}?limit=${pageSize}&offset=${off}`,
    );
    const rows: CommItem[] = result?.items || [];
    if (append) items.value = [...items.value, ...rows];
    else items.value = rows;
    hasMore.value = !!result?.hasMore;
    offset.value = off + rows.length;
  } catch (e: any) {
    error.value = e.message || 'Failed to load communications';
  }
  loading.value = false;
}

async function loadMore() {
  await fetchPage(offset.value, true);
}

onMounted(() => fetchPage(0, false));
</script>

<style scoped>
.comm-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--ss-navy-100);
}

.comm-row:last-child {
  border-bottom: none;
}

.comm-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.comm-body {
  font-size: 13px;
  color: var(--ss-navy-800);
  white-space: pre-wrap;
  line-height: 1.5;
}

.comm-subject {
  color: var(--ss-navy-900);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
</style>
