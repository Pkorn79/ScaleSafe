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
            class="btn btn-sm btn-primary" @click="markMilestone(enr)" :disabled="milestoneLoading">
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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useApi } from '../../composables/useApi';

const props = defineProps<{
  contactId: string;
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

async function markMilestone(enr: any) {
  if (!enr.milestones || (enr.currentMilestone || 0) >= enr.milestones.length) return;
  const nextMilestone = enr.milestones[enr.currentMilestone || 0];
  milestoneLoading.value = true;
  try {
    await api.post('/api/dashboard/mark-milestone', {
      contactId: props.contactId,
      enrollmentId: enr.id,
      milestoneNumber: nextMilestone.number,
    });
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
</style>
