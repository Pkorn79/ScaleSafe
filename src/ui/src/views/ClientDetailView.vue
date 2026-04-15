<template>
  <div>
    <div class="flex-between mb-4">
      <div>
        <h1 class="page-title">{{ clientLabel }}</h1>
        <div class="flex gap-4" style="flex-wrap:wrap;margin-top:2px">
          <span v-if="clientEmail" class="text-sm text-muted">{{ clientEmail }}</span>
          <span v-if="enrollmentInfo?.phone" class="text-sm text-muted">{{ enrollmentInfo.phone }}</span>
          <span v-if="enrollmentInfo?.companyName" class="text-sm text-muted">{{ enrollmentInfo.companyName }}</span>
        </div>
        <div v-if="enrollmentInfo?.tags?.length" style="margin-top:4px">
          <span v-for="tag in enrollmentInfo.tags" :key="tag" class="badge badge-gray" style="margin-right:4px;font-size:11px">{{ tag }}</span>
        </div>
      </div>
      <div class="flex gap-2">
        <button v-if="!pageLoading" class="btn btn-sm btn-secondary" @click="showNoteModal = true">Add Note</button>
        <button v-if="!pageLoading" class="btn btn-sm btn-secondary" @click="showMessageModal = true">Send Message</button>
        <router-link to="/clients" class="btn btn-secondary">Back</router-link>
      </div>
    </div>

    <div v-if="pageLoading" class="loading">Loading client data...</div>

    <div v-if="error && !pageLoading" class="error-msg">{{ error }}</div>

    <!-- Readiness Score -->
    <div v-if="score && !pageLoading" class="card mb-4">
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

    <!-- Programs & Enrollments -->
    <div v-if="!pageLoading" class="card mb-4">
      <div class="flex-between">
        <div>
          <div class="card-title">Programs & Enrollments</div>
          <div v-if="enrollmentSummary" class="text-sm text-muted" style="margin-top:2px">
            {{ enrollmentSummary.total }} program{{ enrollmentSummary.total !== 1 ? 's' : '' }}
            <span v-if="enrollmentSummary.active"> · {{ enrollmentSummary.active }} active</span>
            <span v-if="enrollmentSummary.completed"> · {{ enrollmentSummary.completed }} completed</span>
            <span v-if="enrollmentSummary.cancelled"> · {{ enrollmentSummary.cancelled }} cancelled</span>
            <span v-if="enrollmentSummary.clientSince"> · Client since {{ formatDateShort(enrollmentSummary.clientSince) }}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-primary" @click="openSendOffer">Send Offer</button>
      </div>

      <div v-if="enrollments.length === 0" class="empty-state" style="padding:20px 0">
        <p class="text-sm text-muted">No enrollments yet. Send this client an offer to get started.</p>
      </div>

      <div v-for="enr in enrollments" :key="enr.id" style="margin-top:12px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
        <div class="flex-between">
          <div>
            <strong style="font-size:14px">{{ enr.offerName }}</strong>
            <span class="badge" :class="enrollmentBadge(enr.status)" style="margin-left:8px">{{ enr.status }}</span>
          </div>
          <div class="flex gap-2">
            <button v-if="enr.packetPdfPath && ['enrolled','completed'].includes(enr.status)"
              class="btn btn-sm btn-secondary" @click="downloadPacketFor(enr.id)" :disabled="packetLoading">
              {{ packetLoading ? '...' : 'Packet' }}
            </button>
          </div>
        </div>
        <div class="grid grid-3 mt-2">
          <div class="text-sm">
            <strong>Enrolled:</strong> {{ enr.enrolledAt ? formatDateShort(enr.enrolledAt) : 'Pending' }}
            <span v-if="enr.programDuration" class="text-muted"> ({{ enr.programDuration }} {{ enr.programDurationUnit || '' }})</span>
          </div>
          <div class="text-sm">
            <strong>Payment:</strong>
            <span v-if="enr.paymentType === 'one_time'">${{ (enr.paymentAmount || enr.offerPrice || 0).toFixed(2) }} PIF</span>
            <span v-else-if="enr.paymentType === 'installments' || enr.paymentType === 'installment'">
              {{ enr.paymentsMade || 0 }}/{{ enr.paymentsTotal || '?' }} payments
              <span v-if="enr.installmentAmount" class="text-muted">(${{ Number(enr.installmentAmount).toFixed(2) }}/{{ enr.installmentFrequency || 'mo' }})</span>
            </span>
            <span v-else-if="enr.paymentType === 'subscription'">
              ${{ Number(enr.installmentAmount || enr.paymentAmount || 0).toFixed(2) }}/{{ enr.installmentFrequency || 'mo' }}
            </span>
            <span v-else>${{ (enr.paymentAmount || 0).toFixed(2) }}</span>
          </div>
          <div class="text-sm" v-if="enr.deliveryMethod">
            <strong>Delivery:</strong> {{ enr.deliveryMethod }}
          </div>
        </div>
        <!-- Milestone Progress -->
        <div v-if="enr.milestones && enr.milestones.length > 0" style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">
          <div class="flex-between">
            <div class="text-sm">
              <strong>Milestones:</strong> {{ enr.currentMilestone || 0 }} of {{ enr.milestones.length }} complete
              <span v-if="enr.currentMilestone < enr.milestones.length && enr.milestones[enr.currentMilestone]" class="text-muted">
                — Next: {{ enr.milestones[enr.currentMilestone].name }}
              </span>
            </div>
            <button v-if="enr.currentMilestone < enr.milestones.length && ['enrolled','active'].includes(enr.status)"
              class="btn btn-sm btn-primary" @click="markMilestone(enr)" :disabled="milestoneLoading">
              {{ milestoneLoading ? '...' : 'Mark Complete' }}
            </button>
          </div>
          <!-- Progress bar -->
          <div style="margin-top:4px;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden">
            <div :style="{ width: (enr.milestones.length > 0 ? ((enr.currentMilestone || 0) / enr.milestones.length * 100) : 0) + '%', height: '100%', background: '#10b981', borderRadius: '3px', transition: 'width 0.3s' }"></div>
          </div>
        </div>
        <div v-if="enr.cancelledAt" class="text-sm mt-2" style="color:#ef4444">Cancelled: {{ formatDateShort(enr.cancelledAt) }}</div>
        <div v-if="enr.completedAt" class="text-sm mt-2" style="color:#10b981">Completed: {{ formatDateShort(enr.completedAt) }}</div>
      </div>
      <div v-if="packetError" class="text-sm mt-2" style="color:#ef4444">{{ packetError }}</div>
    </div>

    <!-- Payment Overview -->
    <div v-if="enrollmentInfo && !pageLoading" class="card mb-4">
      <div class="flex-between">
        <div class="card-title">Payment Overview</div>
        <router-link :to="`/payments/${contactId}`" class="btn btn-sm btn-secondary">Manage Payments</router-link>
      </div>
      <div class="grid grid-3 mt-2">
        <div class="text-sm">
          <strong>Card on File:</strong>
          <span v-if="enrollmentInfo.cardOnFile" style="margin-left:4px">
            {{ enrollmentInfo.cardOnFile.brand || 'Card' }} ending in {{ enrollmentInfo.cardOnFile.last4 }}
            <span class="text-muted">({{ enrollmentInfo.cardOnFile.expMonth }}/{{ enrollmentInfo.cardOnFile.expYear }})</span>
          </span>
          <span v-else class="text-muted" style="margin-left:4px">No card on file</span>
        </div>
        <div class="text-sm">
          <strong>Total Charged:</strong> ${{ (enrollmentInfo.totalCharged || 0).toFixed(2) }}
          <span v-if="enrollmentInfo.totalRefunded > 0" class="text-muted"> (${{ enrollmentInfo.totalRefunded.toFixed(2) }} refunded)</span>
        </div>
        <div class="text-sm">
          <strong>Last Payment:</strong> {{ enrollmentInfo.lastPaymentDate ? formatDate(enrollmentInfo.lastPaymentDate) : 'N/A' }}
        </div>
      </div>
      <div v-if="enrollmentInfo.paymentType === 'installments' || enrollmentInfo.paymentType === 'installment'" class="text-sm mt-2">
        <strong>Installment Progress:</strong>
        {{ enrollmentInfo.paymentsMade || 0 }} of {{ enrollmentInfo.paymentsTotal || '?' }} payments made
        <span v-if="enrollmentInfo.installmentAmount" class="text-muted">
          (${{ Number(enrollmentInfo.installmentAmount).toFixed(2) }} / {{ enrollmentInfo.installmentFrequency || 'month' }})
        </span>
      </div>
      <div v-if="enrollmentInfo.paymentType === 'subscription'" class="text-sm mt-2">
        <strong>Subscription:</strong>
        ${{ Number(enrollmentInfo.installmentAmount || enrollmentInfo.paymentAmount || 0).toFixed(2) }} / {{ enrollmentInfo.installmentFrequency || 'month' }} (ongoing)
      </div>
      <div v-if="enrollmentInfo.dunningActive" class="text-sm mt-2" style="color:#ef4444;font-weight:500">
        Dunning active — failed payment being retried.
        <router-link :to="`/payments/${contactId}`" style="color:#3b82f6">View details</router-link>
      </div>
    </div>

    <!-- Evidence Timeline -->
    <div v-if="!pageLoading" class="card">
      <div class="card-title mb-4">Evidence Timeline ({{ timeline.length }} records)</div>

      <div v-if="timeline.length === 0" class="empty-state">
        <p>No evidence recorded for this client yet. Evidence is logged automatically as clients enroll, make payments, and engage with your program.</p>
      </div>

      <table v-if="timeline.length > 0" class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in timeline" :key="i">
            <td class="text-sm">{{ formatDate(item.created_at || item.event_date) }}</td>
            <td>
              <span class="badge badge-blue">{{ formatEvidenceType(item.evidence_type || item.type) }}</span>
            </td>
            <td class="text-sm">{{ summarize(item) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Send Offer Modal -->
    <div v-if="showSendOfferModal" class="modal-overlay" @click.self="showSendOfferModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:4px">Send Offer to {{ clientLabel }}</h3>
        <p class="text-sm text-muted mb-4">{{ clientEmail }}</p>

        <div v-if="offersLoading" class="loading">Loading offers...</div>

        <div v-if="!offersLoading && activeOffers.length === 0" class="text-sm text-muted">
          No active offers. Create an offer first.
        </div>

        <div v-if="!offersLoading && activeOffers.length > 0">
          <div class="form-group">
            <label class="form-label">Select Offer</label>
            <select class="form-select" v-model="selectedOfferId">
              <option value="">Choose an offer...</option>
              <option v-for="o in activeOffers" :key="o.id" :value="o.id">
                {{ o.offer_name }} — ${{ o.price }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="!offersLoading && activeOffers.length > 0" class="form-group">
          <label class="form-label">Send via</label>
          <div class="flex gap-4">
            <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">
              <input type="checkbox" v-model="sendViaEmail" /> Email
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer">
              <input type="checkbox" v-model="sendViaSms" /> SMS
            </label>
          </div>
        </div>

        <div v-if="sendOfferResult" class="text-sm mt-2" :style="{ color: '#10b981' }">{{ sendOfferResult }}</div>
        <div v-if="sendOfferError" class="text-sm mt-2" style="color:#ef4444">{{ sendOfferError }}</div>

        <div class="flex gap-2 mt-4" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showSendOfferModal = false">Close</button>
          <button class="btn btn-primary" @click="submitSendOffer" :disabled="sendOfferLoading || !selectedOfferId">
            {{ sendOfferLoading ? 'Sending...' : 'Send Offer' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Add Note Modal -->
    <div v-if="showNoteModal" class="modal-overlay" @click.self="showNoteModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:12px">Add Note</h3>
        <div class="form-group">
          <textarea class="form-textarea" v-model="noteBody" rows="4" placeholder="Enter note..."></textarea>
        </div>
        <div v-if="noteResult" class="text-sm" :style="{ color: '#10b981', marginBottom: '8px' }">{{ noteResult }}</div>
        <div v-if="noteError" class="text-sm" style="color:#ef4444;margin-bottom:8px">{{ noteError }}</div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showNoteModal = false">Close</button>
          <button class="btn btn-primary" @click="submitNote" :disabled="noteLoading || !noteBody.trim()">
            {{ noteLoading ? 'Saving...' : 'Save Note' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Send Message Modal -->
    <div v-if="showMessageModal" class="modal-overlay" @click.self="showMessageModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:12px">Send Message</h3>
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
        <div v-if="messageResult" class="text-sm" :style="{ color: '#10b981', marginBottom: '8px' }">{{ messageResult }}</div>
        <div v-if="messageError" class="text-sm" style="color:#ef4444;margin-bottom:8px">{{ messageError }}</div>
        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showMessageModal = false">Close</button>
          <button class="btn btn-primary" @click="submitMessage" :disabled="messageLoading || !messageBody.trim()">
            {{ messageLoading ? 'Sending...' : 'Send' }}
          </button>
        </div>
      </div>
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
const enrollmentInfo = ref<any>(null);
const clientEmail = ref('');
const clientLabel = ref('Client');
const pageLoading = ref(true);
const packetLoading = ref(false);
const packetError = ref('');
const enrollments = ref<any[]>([]);
const enrollmentSummary = ref<any>(null);
const milestoneLoading = ref(false);

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

function formatKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

async function markMilestone(enr: any) {
  if (!enr.milestones || enr.currentMilestone >= enr.milestones.length) return;
  const nextMilestone = enr.milestones[enr.currentMilestone];
  milestoneLoading.value = true;
  try {
    await api.post('/api/dashboard/mark-milestone', {
      contactId: contactId.value,
      enrollmentId: enr.id,
      milestoneNumber: nextMilestone.number,
    });
    // Refresh enrollments to show updated progress
    const result = await api.get<any>(`/api/dashboard/client-enrollments/${contactId.value}`);
    if (result) {
      enrollments.value = result.enrollments || [];
      enrollmentSummary.value = result.summary || null;
    }
  } catch (e: any) {
    packetError.value = e.message || 'Failed to mark milestone';
  }
  milestoneLoading.value = false;
}

function formatDateShort(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function enrollmentBadge(status: string): string {
  if (['enrolled', 'active'].includes(status)) return 'badge-green';
  if (status === 'completed') return 'badge-blue';
  if (status === 'cancelled') return 'badge-red';
  if (['consent_captured', 'device_captured', 'pending'].includes(status)) return 'badge-yellow';
  return 'badge-gray';
}

async function downloadPacketFor(enrollmentId: string) {
  packetLoading.value = true;
  packetError.value = '';
  try {
    const headers: Record<string, string> = {};
    const payload = sessionStorage.getItem('ss_sso_payload');
    if (payload) headers['x-sso-payload'] = payload;
    else {
      const loc = sessionStorage.getItem('ss_location_id');
      if (loc) headers['x-location-id'] = loc;
    }
    const res = await fetch(`/api/enrollments/${enrollmentId}/packet?download=true`, { headers });
    if (!res.ok) { packetError.value = `Failed (${res.status})`; return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-packet-${enrollmentId}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    packetError.value = err.message || 'Download failed';
  } finally {
    packetLoading.value = false;
  }
}

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatEvidenceType(type: string): string {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function summarize(item: any): string {
  const type = item.evidence_type || item.type || '';
  const d = item.data || item.summary || item.details;
  if (!d) return '-';
  if (typeof d === 'string') return d.slice(0, 120);
  if (typeof d === 'object') {
    // Consent evidence
    if (type === 'consent') {
      const parts: string[] = [];
      if (d.digital_signature) parts.push(`Signed: ${d.digital_signature}`);
      const clauses = (d.clauses_accepted || []).filter(Boolean);
      if (clauses.length > 0) parts.push(`${clauses.length} clauses accepted`);
      if (d.scroll_depth != null) parts.push(`${d.scroll_depth}% scroll`);
      if (d.ip_address) parts.push(`IP: ${d.ip_address}`);
      if (parts.length > 0) return parts.join(' | ');
    }
    // Payment evidence
    const parts: string[] = [];
    if (d.amount) parts.push(`$${Number(d.amount).toFixed(2)}`);
    if (d.payment_type) parts.push(d.payment_type);
    if (d.transaction_id) parts.push(`Tx: ${d.transaction_id.slice(0, 12)}...`);
    if (d.timestamp) parts.push(formatDate(d.timestamp));
    if (d.source) parts.push(d.source);
    if (parts.length > 0) return parts.join(' | ');
    // Generic fallback — show key fields, not raw JSON
    const keys = Object.keys(d).filter(k => d[k] != null && d[k] !== '');
    const summary = keys.slice(0, 4).map(k => `${k}: ${String(d[k]).slice(0, 30)}`).join(', ');
    return summary || JSON.stringify(d).slice(0, 80);
  }
  return '-';
}

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

async function downloadPacket() {
  const eid = enrollmentInfo.value?.enrollmentId;
  if (!eid) return;

  packetLoading.value = true;
  packetError.value = '';
  try {
    const headers: Record<string, string> = {};
    const payload = sessionStorage.getItem('ss_sso_payload');
    if (payload) {
      headers['x-sso-payload'] = payload;
    } else {
      const loc = sessionStorage.getItem('ss_location_id');
      if (loc) headers['x-location-id'] = loc;
      const comp = sessionStorage.getItem('ss_company_id');
      if (comp) headers['x-company-id'] = comp;
      const uid = sessionStorage.getItem('ss_user_id');
      if (uid) headers['x-user-id'] = uid;
    }

    const res = await fetch(`/api/enrollments/${eid}/packet?download=true`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('Packet download failed:', res.status, body);
      packetError.value = `Failed to generate packet (${res.status})`;
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enrollment-packet-${eid}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    console.error('Packet download error:', err);
    packetError.value = err.message || 'Download failed';
  } finally {
    packetLoading.value = false;
  }
}

onMounted(async () => {
  const cid = contactId.value;

  const [scoreResult, timelineResult, enrollmentResult, enrollmentsResult] = await Promise.allSettled([
    api.get<any>(`/api/evidence/${cid}/score`),
    api.get<any[]>(`/api/evidence/${cid}`),
    api.get<any>(`/api/dashboard/client-info/${cid}`),
    api.get<any>(`/api/dashboard/client-enrollments/${cid}`),
  ]);

  if (scoreResult.status === 'fulfilled') score.value = scoreResult.value;
  if (timelineResult.status === 'fulfilled') timeline.value = timelineResult.value || [];
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

  pageLoading.value = false;
});
</script>
