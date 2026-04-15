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

    <div v-if="enrollments.length === 0" class="empty-state">
      <p class="text-sm text-muted">No enrollments yet. Send this client an offer to get started.</p>
    </div>

    <div v-for="enr in enrollments" :key="enr.id" class="enrollment-card">
      <div class="flex-between">
        <div>
          <strong style="font-size:14px">{{ enr.offerName }}</strong>
          <span class="badge" :class="enrollmentBadge(enr.status)" style="margin-left:8px">{{ enr.status }}</span>
        </div>
        <div class="flex gap-2">
          <button v-if="enr.packetPdfPath && ['enrolled','completed'].includes(enr.status)"
            class="btn btn-sm btn-secondary" @click="downloadPacket(enr.id)" :disabled="packetLoading">
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
          <span v-if="enr.paymentType === 'one_time'">${{ Number(enr.paymentAmount || enr.offerPrice || 0).toFixed(2) }} PIF</span>
          <span v-else-if="enr.paymentType === 'installments' || enr.paymentType === 'installment'">
            {{ enr.paymentsMade || 0 }}/{{ enr.paymentsTotal || '?' }} payments
            <span v-if="enr.installmentAmount" class="text-muted">(${{ Number(enr.installmentAmount).toFixed(2) }}/{{ enr.installmentFrequency || 'mo' }})</span>
          </span>
          <span v-else-if="enr.paymentType === 'subscription'">
            ${{ Number(enr.installmentAmount || enr.paymentAmount || 0).toFixed(2) }}/{{ enr.installmentFrequency || 'mo' }}
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

    <div v-if="packetError" class="text-sm mt-2" style="color:#ef4444">{{ packetError }}</div>

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
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useApi } from '../../composables/useApi';
import Modal from '../../components/Modal.vue';

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

// Mark Complete confirmation modal
const showMilestoneModal = ref(false);
const pendingEnrollment = ref<any>(null);
const pendingMilestone = ref<any>(null);

const clientFirstName = computed(() => {
  const label = (props.clientLabel || '').trim();
  if (!label) return 'this client';
  return label.split(/\s+/)[0];
});

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
    await api.post('/api/dashboard/mark-milestone', {
      contactId: props.contactId,
      enrollmentId: enr.id,
      milestoneNumber: milestone.number,
    });
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
</style>
