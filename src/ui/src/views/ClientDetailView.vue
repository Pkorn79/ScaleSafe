<template>
  <div class="client-profile">
    <!-- Sticky header -->
    <header class="profile-header">
      <div class="profile-header-main">
        <div class="profile-header-text">
          <h1 class="profile-name">{{ clientLabel }}</h1>
          <div class="profile-meta">
            <span v-if="clientEmail" class="text-sm text-muted">{{ clientEmail }}</span>
            <span v-if="enrollmentInfo?.phone" class="text-sm text-muted">{{ enrollmentInfo.phone }}</span>
            <span v-if="enrollmentInfo?.companyName" class="text-sm text-muted">{{ enrollmentInfo.companyName }}</span>
            <span
              v-if="enrollmentInfo?.status && enrollmentInfo.status !== 'unknown'"
              class="badge"
              :class="statusBadge(enrollmentInfo.status)"
            >
              {{ humanizeEventType(enrollmentInfo.status) }}
            </span>
          </div>
          <div v-if="enrollmentInfo?.tags?.length" class="profile-tags">
            <span v-for="tag in enrollmentInfo.tags" :key="tag" class="badge badge-gray profile-tag">{{ tag }}</span>
          </div>
        </div>
        <div class="profile-header-actions">
          <button v-if="!pageLoading" class="btn btn-sm btn-secondary" @click="showNoteModal = true">Add Note</button>
          <button v-if="!pageLoading" class="btn btn-sm btn-secondary" @click="showMessageModal = true">Send Message</button>
          <button v-if="!pageLoading" class="btn btn-sm btn-primary" @click="openSendOffer">Send Offer</button>
          <button v-if="!pageLoading" class="btn btn-sm btn-secondary" @click="openAssignOffer">Assign Offer</button>
          <router-link to="/clients" class="btn btn-sm btn-secondary">Back</router-link>
        </div>
      </div>

      <!-- Summary strip -->
      <div v-if="!pageLoading && enrollmentInfo" class="summary-strip">
        <div class="summary-cell" @click="activeTab = 'overview'" role="button">
          <div class="summary-label">Readiness</div>
          <div class="summary-value" :style="{ color: scoreColor(score?.score || 0) }">
            {{ score?.score ?? '—' }}
          </div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">Active</div>
          <div class="summary-value">{{ enrollmentSummary?.active || 0 }}</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">Paid Lifetime</div>
          <div class="summary-value">${{ Number(enrollmentInfo?.totalCharged || 0).toFixed(2) }}</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">Next Billing</div>
          <div class="summary-value-sm">{{ nextBillingShort || '—' }}</div>
        </div>
        <div class="summary-cell">
          <div class="summary-label">Last Activity</div>
          <div class="summary-value-sm">{{ lastActivityShort || '—' }}</div>
        </div>
      </div>

      <!-- Tab nav -->
      <ProfileTabs v-if="!pageLoading" v-model="activeTab" :tabs="tabs" />
    </header>

    <!-- Loading / error -->
    <div v-if="pageLoading" class="loading">Loading client data...</div>
    <div v-if="error && !pageLoading" class="error-msg">{{ error }}</div>

    <!-- Tab bodies -->
    <section v-if="!pageLoading" class="tab-body">
      <OverviewTab
        v-if="activeTab === 'overview'"
        :contact-id="contactId"
        :score="score"
        :enrollment-info="enrollmentInfo"
        :enrollments="enrollments"
        :summary="enrollmentSummary"
        :recent-activity="recentActivity"
        :recent-note="recentNote"
        :at-risk="atRisk"
      />
      <ProgramsTab
        v-else-if="activeTab === 'programs'"
        :contact-id="contactId"
        :client-label="clientLabel"
        :enrollments="enrollments"
        :summary="enrollmentSummary"
        @send-offer="openSendOffer"
        @enrollments-updated="reloadEnrollments"
      />
      <PaymentsTab
        v-else-if="activeTab === 'payments'"
        :contact-id="contactId"
        :enrollment-info="enrollmentInfo"
        :enrollments="enrollments"
      />
      <EvidenceTab
        v-else-if="activeTab === 'evidence'"
        :contact-id="contactId"
      />
      <CommunicationsTab
        v-else-if="activeTab === 'communications'"
        :contact-id="contactId"
        @add-note="showNoteModal = true"
        @send-message="showMessageModal = true"
      />
      <FilesTab
        v-else-if="activeTab === 'files'"
        :contact-id="contactId"
      />
    </section>

    <!-- Send Offer Modal -->
    <Modal v-model:open="showSendOfferModal" :title="`Send Offer to ${clientLabel}`">
      <p v-if="clientEmail" class="text-sm text-muted" style="margin-top:-4px;margin-bottom:12px">{{ clientEmail }}</p>

      <div v-if="offersLoading" class="loading">Loading offers...</div>
      <div v-else-if="activeOffers.length === 0" class="text-sm text-muted">
        No active offers. Create an offer first.
      </div>
      <template v-else>
        <div class="form-group">
          <label class="form-label">Select Offer</label>
          <select class="form-select" v-model="selectedOfferId">
            <option value="">Choose an offer...</option>
            <option v-for="o in activeOffers" :key="o.id" :value="o.id">
              {{ o.offer_name }} — ${{ o.price }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Send via</label>
          <div class="flex gap-4">
            <label class="inline-check">
              <input type="checkbox" v-model="sendViaEmail" /> Email
            </label>
            <label class="inline-check">
              <input type="checkbox" v-model="sendViaSms" /> SMS
            </label>
          </div>
        </div>
      </template>

      <div v-if="sendOfferResult" class="text-sm mt-2" style="color:#10b981">{{ sendOfferResult }}</div>
      <div v-if="sendOfferError" class="text-sm mt-2" style="color:#ef4444">{{ sendOfferError }}</div>

      <template #footer>
        <button class="btn btn-secondary" @click="showSendOfferModal = false">Close</button>
        <button class="btn btn-primary" @click="submitSendOffer" :disabled="sendOfferLoading || !selectedOfferId">
          {{ sendOfferLoading ? 'Sending...' : 'Send Offer' }}
        </button>
      </template>
    </Modal>

    <!-- Assign Offer Modal -->
    <Modal v-model:open="showAssignOfferModal" :title="`Assign Offer to ${clientLabel}`">
      <p class="text-sm text-muted" style="margin-top:-4px;margin-bottom:12px">
        Directly enroll this client in a program. No consent pages or payment required.
      </p>

      <div v-if="offersLoading" class="loading">Loading offers...</div>
      <div v-else-if="activeOffers.length === 0" class="text-sm text-muted">
        No active offers. Create an offer first.
      </div>
      <template v-else>
        <div class="form-group">
          <label class="form-label">Select Offer</label>
          <select class="form-select" v-model="assignOfferId">
            <option value="">Choose an offer...</option>
            <option v-for="o in activeOffers" :key="o.id" :value="o.id">
              {{ o.offer_name }} — ${{ o.price || 0 }}
            </option>
          </select>
        </div>
      </template>

      <div v-if="assignOfferResult" class="text-sm mt-2" style="color:#10b981">{{ assignOfferResult }}</div>
      <div v-if="assignOfferError" class="text-sm mt-2" style="color:#ef4444">{{ assignOfferError }}</div>

      <template #footer>
        <button class="btn btn-secondary" @click="showAssignOfferModal = false">Cancel</button>
        <button class="btn btn-primary" @click="submitAssignOffer" :disabled="assignOfferLoading || !assignOfferId">
          {{ assignOfferLoading ? 'Assigning...' : 'Assign & Enroll' }}
        </button>
      </template>
    </Modal>

    <!-- Add Note Modal -->
    <Modal v-model:open="showNoteModal" title="Add Note">
      <div class="form-group">
        <textarea class="form-textarea" v-model="noteBody" rows="4" placeholder="Enter note..."></textarea>
      </div>
      <div v-if="noteResult" class="text-sm" style="color:#10b981;margin-bottom:8px">{{ noteResult }}</div>
      <div v-if="noteError" class="text-sm" style="color:#ef4444;margin-bottom:8px">{{ noteError }}</div>

      <template #footer>
        <button class="btn btn-secondary" @click="showNoteModal = false">Close</button>
        <button class="btn btn-primary" @click="submitNote" :disabled="noteLoading || !noteBody.trim()">
          {{ noteLoading ? 'Saving...' : 'Save Note' }}
        </button>
      </template>
    </Modal>

    <!-- Send Message Modal -->
    <Modal v-model:open="showMessageModal" title="Send Message">
      <div class="form-group">
        <label class="form-label">Send via</label>
        <select class="form-select" v-model="messageType">
          <option value="email">Email</option>
          <option value="sms">SMS</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Message</label>
        <textarea class="form-textarea" v-model="messageBody" rows="4" placeholder="Type your message..."></textarea>
      </div>
      <div v-if="messageResult" class="text-sm" style="color:#10b981;margin-bottom:8px">{{ messageResult }}</div>
      <div v-if="messageError" class="text-sm" style="color:#ef4444;margin-bottom:8px">{{ messageError }}</div>

      <template #footer>
        <button class="btn btn-secondary" @click="showMessageModal = false">Close</button>
        <button class="btn btn-primary" @click="submitMessage" :disabled="messageLoading || !messageBody.trim()">
          {{ messageLoading ? 'Sending...' : 'Send' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';
import ProfileTabs, { type TabDef } from '../components/ProfileTabs.vue';
import {
  LayoutDashboard, Package, CreditCard, FileText, MessageSquare, Folder,
} from 'lucide-vue-next';
import OverviewTab from './client-profile/OverviewTab.vue';
import ProgramsTab from './client-profile/ProgramsTab.vue';
import PaymentsTab from './client-profile/PaymentsTab.vue';
import EvidenceTab from './client-profile/EvidenceTab.vue';
import CommunicationsTab from './client-profile/CommunicationsTab.vue';
import FilesTab from './client-profile/FilesTab.vue';
import { humanizeEventType } from '../utils/humanize';

const route = useRoute();
const api = useApi();
const { error } = api;

const contactId = computed(() => route.params.contactId as string);

// Shared state — header-owned
const score = ref<any>(null);
const enrollmentInfo = ref<any>(null);
const clientEmail = ref('');
const clientLabel = ref('Client');
const pageLoading = ref(true);
const enrollments = ref<any[]>([]);
const enrollmentSummary = ref<any>(null);

// Overview tab data
const recentActivity = ref<any[]>([]);
const recentNote = ref<{ body: string; createdAt: string } | null>(null);
const atRisk = ref<{ flagged: boolean; riskFactors: string[] } | null>(null);

// Tabs
const tabs: TabDef[] = [
  { key: 'overview',       label: 'Overview',       icon: LayoutDashboard },
  { key: 'programs',       label: 'Programs',       icon: Package },
  { key: 'payments',       label: 'Payments',       icon: CreditCard },
  { key: 'evidence',       label: 'Evidence',       icon: FileText },
  { key: 'communications', label: 'Messages',       icon: MessageSquare },
  { key: 'files',          label: 'Files',          icon: Folder },
];

// Active tab — persist to URL hash
function initialTab(): string {
  const hash = (typeof window !== 'undefined' && window.location.hash || '').replace('#', '');
  return tabs.some(t => t.key === hash) ? hash : 'overview';
}
const activeTab = ref(initialTab());
watch(activeTab, (val) => {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.hash = val;
    window.history.replaceState({}, '', url.toString());
  }
});

// Send Offer modal
const showSendOfferModal = ref(false);
const activeOffers = ref<any[]>([]);
const offersLoading = ref(false);
const selectedOfferId = ref('');
const sendOfferLoading = ref(false);
const sendOfferResult = ref('');
const sendOfferError = ref('');
const sendViaEmail = ref(true);
const sendViaSms = ref(false);

// Assign Offer modal
const showAssignOfferModal = ref(false);
const assignOfferId = ref('');
const assignOfferLoading = ref(false);
const assignOfferResult = ref('');
const assignOfferError = ref('');

// Note modal
const showNoteModal = ref(false);
const noteBody = ref('');
const noteLoading = ref(false);
const noteResult = ref('');
const noteError = ref('');

// Message modal
const showMessageModal = ref(false);
const messageType = ref('email');
const messageBody = ref('');
const messageLoading = ref(false);
const messageResult = ref('');
const messageError = ref('');

function scoreColor(s: number): string {
  if (s >= 70) return '#10b981';
  if (s >= 40) return '#f59e0b';
  return '#ef4444';
}

function statusBadge(status: string): string {
  if (['enrolled', 'active'].includes(status)) return 'badge-green';
  if (status === 'completed') return 'badge-blue';
  if (status === 'cancelled') return 'badge-red';
  if (['paused', 'consent_captured', 'pending'].includes(status)) return 'badge-yellow';
  return 'badge-gray';
}

function formatDateShort(d: string | null): string {
  if (!d) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(d);
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Summary strip derived values
const nextBillingShort = computed(() => {
  const upcoming = enrollments.value
    .filter(e => ['enrolled', 'active'].includes(e.status))
    .map(e => e.nextBillingDate)
    .filter(Boolean)
    .sort();
  return upcoming.length > 0 ? formatDateShort(upcoming[0]) : '';
});

const lastActivityShort = computed(() => {
  if (recentActivity.value.length === 0) return '';
  const first = recentActivity.value[0];
  return formatDateShort(first.created_at || first.event_date);
});

// Header actions
async function openSendOffer() {
  showSendOfferModal.value = true;
  sendOfferResult.value = '';
  sendOfferError.value = '';
  selectedOfferId.value = '';
  if (activeOffers.value.length === 0) {
    offersLoading.value = true;
    try {
      const offers = await api.get<any[]>('/api/offers');
      activeOffers.value = (offers || []).filter(o => o.active);
    } catch (e: any) {
      sendOfferError.value = e.message || 'Failed to load offers';
    }
    offersLoading.value = false;
  }
}

async function submitSendOffer() {
  if (!selectedOfferId.value || !clientEmail.value) return;
  const sendVia: string[] = [];
  if (sendViaEmail.value) sendVia.push('email');
  if (sendViaSms.value) sendVia.push('sms');
  if (sendVia.length === 0) { sendOfferError.value = 'Select email or SMS'; return; }

  sendOfferLoading.value = true;
  sendOfferError.value = '';
  sendOfferResult.value = '';
  try {
    const parts = clientLabel.value.split(' ');
    await api.post('/api/enrollment/send-link', {
      offerId: selectedOfferId.value,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      email: clientEmail.value,
      phone: enrollmentInfo.value?.phone || '',
      sendVia,
    });
    sendOfferResult.value = 'Offer sent successfully!';
    selectedOfferId.value = '';
  } catch (e: any) {
    sendOfferError.value = e.message || 'Failed to send offer';
  }
  sendOfferLoading.value = false;
}

async function openAssignOffer() {
  showAssignOfferModal.value = true;
  assignOfferResult.value = '';
  assignOfferError.value = '';
  assignOfferId.value = '';
  if (activeOffers.value.length === 0) {
    offersLoading.value = true;
    try {
      const offers = await api.get<any[]>('/api/offers');
      activeOffers.value = (offers || []).filter(o => o.active);
    } catch (e: any) {
      assignOfferError.value = e.message || 'Failed to load offers';
    }
    offersLoading.value = false;
  }
}

async function submitAssignOffer() {
  if (!assignOfferId.value) return;
  assignOfferLoading.value = true;
  assignOfferError.value = '';
  assignOfferResult.value = '';
  try {
    await api.post('/api/dashboard/assign-offer', {
      contactId: contactId.value,
      offerId: assignOfferId.value,
    });
    assignOfferResult.value = 'Client enrolled successfully!';
    assignOfferId.value = '';
    // Refresh enrollments
    await reloadEnrollments();
  } catch (e: any) {
    assignOfferError.value = e.message || 'Failed to assign offer';
  }
  assignOfferLoading.value = false;
}

async function submitNote() {
  if (!noteBody.value.trim()) return;
  noteLoading.value = true;
  noteError.value = '';
  noteResult.value = '';
  try {
    await api.post('/api/dashboard/client-note', {
      contactId: contactId.value,
      body: noteBody.value,
    });
    noteResult.value = 'Note saved!';
    noteBody.value = '';
    setTimeout(() => { noteResult.value = ''; }, 3000);
  } catch (e: any) {
    noteError.value = e.message || 'Failed to save note';
  }
  noteLoading.value = false;
}

async function submitMessage() {
  if (!messageBody.value.trim()) return;
  messageLoading.value = true;
  messageError.value = '';
  messageResult.value = '';
  try {
    await api.post('/api/dashboard/client-message', {
      contactId: contactId.value,
      type: messageType.value,
      message: messageBody.value,
    });
    messageResult.value = 'Message sent!';
    messageBody.value = '';
    setTimeout(() => { messageResult.value = ''; }, 3000);
  } catch (e: any) {
    messageError.value = e.message || 'Failed to send message';
  }
  messageLoading.value = false;
}

async function reloadEnrollments() {
  const result = await api.get<any>(`/api/dashboard/client-enrollments/${contactId.value}`);
  if (result) {
    enrollments.value = result.enrollments || [];
    enrollmentSummary.value = result.summary || null;
  }
}

// Initial load
onMounted(async () => {
  const cid = contactId.value;

  // Add class on body so main gets bottom padding for mobile bottom-nav
  if (typeof document !== 'undefined') {
    document.body.classList.add('ss-profile-open');
  }

  // Core header data — always fetched
  const [scoreResult, enrollmentResult, enrollmentsResult] = await Promise.allSettled([
    api.get<any>(`/api/evidence/${cid}/score`),
    api.get<any>(`/api/dashboard/client-info/${cid}`),
    api.get<any>(`/api/dashboard/client-enrollments/${cid}`),
  ]);

  if (scoreResult.status === 'fulfilled') score.value = scoreResult.value;
  if (enrollmentResult.status === 'fulfilled' && enrollmentResult.value) {
    enrollmentInfo.value = enrollmentResult.value;
    clientEmail.value = enrollmentResult.value.email || '';
    clientLabel.value = enrollmentResult.value.name || enrollmentResult.value.email || 'Client';
  } else {
    clientLabel.value = cid.includes('@') ? cid : 'Client';
  }
  if (enrollmentsResult.status === 'fulfilled' && enrollmentsResult.value) {
    enrollments.value = enrollmentsResult.value.enrollments || [];
    enrollmentSummary.value = enrollmentsResult.value.summary || null;
  }

  // Overview data — bundled endpoint (built in Sub-phase C)
  try {
    pageLoading.value = false;
    const activity = await api.get<any>(`/api/dashboard/client-activity/${cid}?limit=5`);
    recentActivity.value = activity?.recentActivity || [];
    recentNote.value = activity?.recentNote || null;
    atRisk.value = activity?.atRisk || null;
  } catch {
    // Endpoint not available — leave as defaults; OverviewTab handles empty state.
  }

  pageLoading.value = false;
});

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.classList.remove('ss-profile-open');
  }
});
</script>

<style scoped>
.client-profile {
  /* Root container — header sticks, body scrolls */
}

.profile-header {
  position: sticky;
  top: 0;
  background: #f8fafc;
  z-index: 50;
  /* Pull through .page-shell padding so the sticky header spans gutter-to-gutter.
     Values must match .page-shell horizontal padding (App.vue): 32 / 24 / 16. */
  margin: -32px -32px 0;
  padding: 28px 32px 0;
}
@media (max-width: 1024px) {
  .profile-header {
    margin: -24px -24px 0;
    padding: 20px 24px 0;
  }
}
@media (max-width: 640px) {
  .profile-header {
    margin: -20px -16px 0;
    padding: 16px 16px 0;
  }
}

.profile-header-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.profile-header-text {
  min-width: 0;
}

.profile-name {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
  margin: 0 0 4px;
  line-height: 1.2;
}

.profile-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.profile-tags {
  margin-top: 6px;
}

.profile-tag {
  margin-right: 4px;
  font-size: 11px;
}

.profile-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.summary-cell {
  background: #fff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px 14px;
}

.summary-label {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 500;
  margin-bottom: 4px;
}

.summary-value {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.summary-value-sm {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}

.tab-body {
  padding: 16px 0 0;
}

.inline-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

/* Mobile adjustments */
@media (max-width: 768px) {
  .profile-header {
    margin: -24px -24px 0;
    padding: 16px 16px 0;
  }

  .profile-name {
    font-size: 18px;
  }

  .profile-header-main {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 10px;
  }

  .profile-header-actions {
    justify-content: flex-start;
  }

  .summary-strip {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .summary-cell {
    padding: 8px 10px;
  }

  .summary-value {
    font-size: 16px;
  }

  .summary-value-sm {
    font-size: 12px;
  }
}
</style>
