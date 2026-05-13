<template>
  <div>
    <div class="flex-between mb-4">
      <div>
        <div class="card-title" style="margin-bottom:0">Programs &amp; Enrollments</div>
        <div v-if="summary" class="text-sm text-muted" style="margin-top:2px">
          {{ summary.total }} program{{ summary.total !== 1 ? 's' : '' }}
          <span v-if="summary.active"> · {{ summary.active }} active</span>
          <span v-if="summary.completed"> · {{ summary.completed }} completed</span>
          <span v-if="summary.cancelled"> · {{ summary.cancelled }} cancelled</span>
          <span v-if="summary.clientSince"> · Client since {{ formatDateShort(summary.clientSince) }}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-primary" @click="$emit('send-offer')">Send Offer</button>
    </div>

    <EmptyState
      v-if="enrollments.length === 0"
      :icon="GraduationCap"
      title="No enrollments yet"
      body="This client hasn't been enrolled in any program. Send them an offer to get started — the enrollment funnel handles consent capture and payment automatically."
      cta-label="Send Offer"
      @cta-click="$emit('send-offer')"
    />

    <div v-for="enr in enrollments" :key="enr.id" class="enrollment-card">
      <div class="flex-between">
        <div>
          <strong style="font-size:14px">{{ enr.offerName }}</strong>
          <span class="badge" :class="enrollmentBadge(enr.status)" style="margin-left:8px">{{ enr.status }}</span>
        </div>
        <div class="flex gap-2">
          <!-- Status action buttons -->
          <button v-if="canPause(enr)" class="btn btn-sm btn-secondary" @click="openActionModal(enr, 'pause')" :disabled="actionLoading">Pause</button>
          <button v-if="canResume(enr)" class="btn btn-sm btn-secondary" @click="executeAction(enr, 'resume')" :disabled="actionLoading">Resume</button>
          <button v-if="canComplete(enr)" class="btn btn-sm btn-secondary" @click="openActionModal(enr, 'complete')" :disabled="actionLoading">Complete</button>
          <button v-if="canCancel(enr)" class="btn btn-sm btn-red" @click="openActionModal(enr, 'cancel')" :disabled="actionLoading">Cancel</button>
          <button v-if="enr.packetPdfPath && ['enrolled','completed'].includes(enr.status)"
            class="btn btn-sm btn-secondary" @click="downloadPacket(enr.id)" :disabled="packetLoading">
            {{ packetLoading ? '...' : 'Packet' }}
          </button>
        </div>
      </div>
      <div class="grid grid-3 mt-2">
        <div class="text-sm">
          <strong>Enrolled:</strong> {{ enr.enrolledAt ? formatDateShort(enr.enrolledAt) : 'Pending' }}
          <span v-if="enr.programDuration" class="text-muted"> ({{ pluralize(enr.programDuration, enr.programDurationUnit || 'months') }})</span>
          <div v-if="programEndDate(enr)" class="text-muted" style="font-size:12px">
            Ends: {{ programEndDate(enr) }}
          </div>
        </div>
        <div class="text-sm">
          <strong>Payment:</strong>
          <span v-if="enr.paymentType === 'one_time'">${{ Number(enr.paymentAmount || enr.offerPrice || 0).toFixed(2) }} PIF</span>
          <span v-else-if="enr.paymentType === 'installments' || enr.paymentType === 'installment'">
            {{ enr.paymentsMade || 0 }}/{{ enr.paymentsTotal || '?' }} payments
            <span v-if="enr.installmentAmount" class="text-muted">(${{ Number(enr.installmentAmount).toFixed(2) }}/{{ shortFrequency(enr.installmentFrequency) }})</span>
          </span>
          <span v-else-if="enr.paymentType === 'subscription'">
            ${{ Number(enr.installmentAmount || enr.paymentAmount || 0).toFixed(2) }}/{{ shortFrequency(enr.installmentFrequency) }}
          </span>
          <span v-else>${{ Number(enr.paymentAmount || 0).toFixed(2) }}</span>
        </div>
        <div class="text-sm" v-if="enr.deliveryMethod">
          <strong>Delivery:</strong> {{ enr.deliveryMethod }}
        </div>
      </div>

      <!-- Milestone progress -->
      <div v-if="enr.milestones && enr.milestones.length > 0" class="milestone-block">
        <div class="flex-between">
          <div class="text-sm">
            <strong>Milestones:</strong> {{ enr.currentMilestone || 0 }} of {{ enr.milestones.length }} complete
            <span v-if="(enr.currentMilestone || 0) < enr.milestones.length && enr.milestones[enr.currentMilestone || 0]" class="text-muted">
              — Next: {{ enr.milestones[enr.currentMilestone || 0].name }}
            </span>
          </div>
          <button v-if="(enr.currentMilestone || 0) < enr.milestones.length && ['enrolled','active'].includes(enr.status)"
            class="btn btn-sm btn-primary" @click="confirmMilestone(enr)" :disabled="milestoneLoading">
            {{ milestoneLoading ? '...' : 'Mark Complete' }}
          </button>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: (enr.milestones.length > 0 ? ((enr.currentMilestone || 0) / enr.milestones.length * 100) : 0) + '%' }"
          ></div>
        </div>
      </div>

      <div v-if="enr.cancelledAt" class="text-sm mt-2" style="color:#ef4444">Cancelled: {{ formatDateShort(enr.cancelledAt) }}</div>
      <div v-if="enr.completedAt" class="text-sm mt-2" style="color:#10b981">Completed: {{ formatDateShort(enr.completedAt) }}</div>
    </div>

    <div v-if="packetError || actionError" class="text-sm mt-2" style="color:#ef4444">{{ packetError || actionError }}</div>

    <!-- Mark Complete confirmation modal -->
    <Modal v-model:open="showMilestoneModal" title="Mark milestone complete">
      <div v-if="pendingMilestone">
        <p style="margin-bottom:14px">
          Mark this milestone complete for <strong>{{ clientFirstName }}</strong>?
          They'll receive a confirmation request to sign off.
        </p>
        <div class="milestone-preview">
          <div class="milestone-preview-row">
            <strong>Milestone {{ pendingMilestone.number }}:</strong> {{ pendingMilestone.name }}
          </div>
          <div v-if="pendingMilestone.delivers" class="milestone-preview-row">
            <div class="milestone-preview-label">What you delivered:</div>
            <div class="milestone-preview-body">{{ pendingMilestone.delivers }}</div>
          </div>
          <div v-if="pendingMilestone.clientDoes" class="milestone-preview-row">
            <div class="milestone-preview-label">What the client does:</div>
            <div class="milestone-preview-body">{{ pendingMilestone.clientDoes }}</div>
          </div>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showMilestoneModal = false">Cancel</button>
        <button class="btn btn-primary" @click="executeMilestone" :disabled="milestoneLoading">
          {{ milestoneLoading ? 'Marking...' : 'Mark Complete' }}
        </button>
      </template>
    </Modal>

    <!-- Status action confirmation modal -->
    <Modal v-model:open="showActionModal" :title="actionModalTitle">
      <div v-if="pendingAction">
        <p style="margin-bottom:14px">
          {{ actionModalDescription }}
        </p>
        <div v-if="pendingAction.action !== 'complete'" class="form-group">
          <label class="form-label">Reason (optional)</label>
          <textarea class="form-textarea" v-model="actionReason" rows="2" placeholder="Why are you making this change?"></textarea>
        </div>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="showActionModal = false">Go Back</button>
        <button
          class="btn" :class="pendingAction?.action === 'cancel' ? 'btn-red' : 'btn-primary'"
          @click="confirmAction" :disabled="actionLoading"
        >
          {{ actionLoading ? 'Processing...' : actionModalConfirmLabel }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { GraduationCap } from 'lucide-vue-next';
import { useApi } from '../../composables/useApi';
import Modal from '../../components/Modal.vue';
import EmptyState from '../../components/EmptyState.vue';
import { pluralize } from '../../utils/humanize';

const props = defineProps<{
  contactId: string;
  clientLabel?: string;
  enrollments: any[];
  summary: any;
}>();

const emit = defineEmits<{
  (e: 'send-offer'): void;
  (e: 'enrollments-updated'): void;
}>();

const api = useApi();

const packetLoading = ref(false);
const packetError = ref('');
const milestoneLoading = ref(false);
const actionLoading = ref(false);
const actionError = ref('');

// Milestone modal
const showMilestoneModal = ref(false);
const pendingEnrollment = ref<any>(null);
const pendingMilestone = ref<any>(null);

// Status action modal
const showActionModal = ref(false);
const pendingAction = ref<{ enrollment: any; action: string } | null>(null);
const actionReason = ref('');

const clientFirstName = computed(() => {
  const label = (props.clientLabel || '').trim();
  if (!label) return 'this client';
  return label.split(/\s+/)[0];
});

const actionModalTitle = computed(() => {
  if (!pendingAction.value) return '';
  const labels: Record<string, string> = { pause: 'Pause Enrollment', cancel: 'Cancel Enrollment', complete: 'Mark Complete' };
  return labels[pendingAction.value.action] || 'Update Status';
});

const actionModalDescription = computed(() => {
  if (!pendingAction.value) return '';
  const name = pendingAction.value.enrollment.offerName || 'this program';
  const labels: Record<string, string> = {
    pause: `Pause "${name}" for ${clientFirstName.value}? Recurring billing will be suspended until you resume.`,
    cancel: `Cancel "${name}" for ${clientFirstName.value}? This will stop all future billing and mark the enrollment as cancelled.`,
    complete: `Mark "${name}" as complete for ${clientFirstName.value}? This will end the program and stop future billing.`,
  };
  return labels[pendingAction.value.action] || '';
});

const actionModalConfirmLabel = computed(() => {
  if (!pendingAction.value) return 'Confirm';
  const labels: Record<string, string> = { pause: 'Pause', cancel: 'Cancel Enrollment', complete: 'Mark Complete' };
  return labels[pendingAction.value.action] || 'Confirm';
});

// Status action visibility
function canPause(enr: any): boolean {
  return ['enrolled', 'active'].includes(enr.status);
}
function canResume(enr: any): boolean {
  return enr.status === 'paused';
}
function canCancel(enr: any): boolean {
  return ['enrolled', 'active', 'paused', 'consent_captured', 'device_captured'].includes(enr.status);
}
function canComplete(enr: any): boolean {
  return ['enrolled', 'active'].includes(enr.status);
}

function shortFrequency(freq?: string): string {
  const map: Record<string, string> = {
    weekly: 'wk',
    bi_weekly: '2wk',
    monthly: 'mo',
    quarterly: 'qtr',
    annual: 'yr',
    annually: 'yr',
  };
  if (!freq) return 'mo';
  return map[freq.toLowerCase()] || freq;
}

function programEndDate(enr: any): string {
  if (!enr.enrolledAt || !enr.programDuration) return '';
  const enrolled = new Date(enr.enrolledAt);
  const unit = (enr.programDurationUnit || 'months').toLowerCase();
  if (unit === 'weeks') {
    enrolled.setDate(enrolled.getDate() + enr.programDuration * 7);
  } else {
    enrolled.setMonth(enrolled.getMonth() + enr.programDuration);
  }
  return enrolled.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function openActionModal(enr: any, action: string) {
  pendingAction.value = { enrollment: enr, action };
  actionReason.value = '';
  actionError.value = '';
  showActionModal.value = true;
}

async function confirmAction() {
  if (!pendingAction.value) return;
  await executeAction(pendingAction.value.enrollment, pendingAction.value.action, actionReason.value);
  showActionModal.value = false;
  pendingAction.value = null;
}

async function executeAction(enr: any, action: string, reason?: string) {
  actionLoading.value = true;
  actionError.value = '';
  try {
    await api.post('/api/payments/lifecycle/enrollment/status', {
      enrollmentId: enr.id,
      contactId: props.contactId,
      action,
      reason: reason || undefined,
    });
    emit('enrollments-updated');
  } catch (e: any) {
    actionError.value = e.message || `Failed to ${action} enrollment`;
  }
  actionLoading.value = false;
}

function formatDateShort(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function enrollmentBadge(status: string): string {
  if (['enrolled', 'active'].includes(status)) return 'badge-green';
  if (status === 'completed') return 'badge-blue';
  if (status === 'cancelled') return 'badge-red';
  if (status === 'paused') return 'badge-yellow';
  if (['consent_captured', 'device_captured', 'pending'].includes(status)) return 'badge-yellow';
  return 'badge-gray';
}

function confirmMilestone(enr: any) {
  if (!enr.milestones || (enr.currentMilestone || 0) >= enr.milestones.length) return;
  pendingEnrollment.value = enr;
  pendingMilestone.value = enr.milestones[enr.currentMilestone || 0];
  packetError.value = '';
  showMilestoneModal.value = true;
}

async function executeMilestone() {
  const enr = pendingEnrollment.value;
  const milestone = pendingMilestone.value;
  if (!enr || !milestone) return;
  milestoneLoading.value = true;
  try {
    const result = await api.post<any>('/api/dashboard/mark-milestone', {
      contactId: props.contactId,
      enrollmentId: enr.id,
      milestoneNumber: milestone.number,
    });
    enr.currentMilestone = result?.currentMilestone || milestone.number;
    showMilestoneModal.value = false;
    pendingEnrollment.value = null;
    pendingMilestone.value = null;
    emit('enrollments-updated');
  } catch (e: any) {
    packetError.value = e.message || 'Failed to mark milestone';
  }
  milestoneLoading.value = false;
}

async function downloadPacket(enrollmentId: string) {
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
</script>

<style scoped>
.enrollment-card {
  margin-top: 12px;
  padding: 14px 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.milestone-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e5e7eb;
}

.progress-track {
  margin-top: 4px;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #10b981;
  border-radius: 3px;
  transition: width 0.3s;
}

.empty-state {
  padding: 20px 0;
}

.milestone-preview {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 16px;
}

.milestone-preview-row {
  margin-bottom: 10px;
}

.milestone-preview-row:last-child {
  margin-bottom: 0;
}

.milestone-preview-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 4px;
}

.milestone-preview-body {
  font-size: 14px;
  color: #1e293b;
  white-space: pre-wrap;
  line-height: 1.5;
}

.btn-red {
  background: #ef4444;
  color: #fff;
  border: none;
}
.btn-red:hover {
  background: #dc2626;
}

.form-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
}
</style>
