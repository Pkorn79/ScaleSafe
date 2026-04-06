<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Offers</h1>
      <router-link to="/offers/new" class="btn btn-primary">
        <Plus :size="16" /> New Offer
      </router-link>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading offers...</div>

    <div v-if="offers.length === 0 && !loading" class="empty-state">
      <Package :size="48" class="mx-auto mb-4 text-slate-300" style="display:block;margin:0 auto 16px" />
      <p>No offers yet. Create your first offer to start enrolling clients.</p>
    </div>

    <div class="card" v-if="offers.length > 0">
      <table class="table">
        <thead>
          <tr>
            <th>Offer Name</th>
            <th>Price</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Link</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="offer in offers" :key="offer.id">
            <td>
              <strong>{{ offer.offer_name }}</strong>
              <div class="text-sm text-muted">{{ offer.delivery_method || 'Not set' }}</div>
            </td>
            <td>${{ offer.price || 0 }}</td>
            <td>
              <span class="badge" :class="offer.payment_type === 'one_time' ? 'badge-blue' : 'badge-green'">
                {{ offer.payment_type === 'one_time' ? 'Pay in Full' : `${offer.num_payments}x $${offer.installment_amount}` }}
              </span>
            </td>
            <td>
              <span class="badge" :class="offer.active ? 'badge-green' : 'badge-gray'">
                {{ offer.active ? 'Active' : 'Inactive' }}
              </span>
              <span v-if="offer.checkout_mode === 'quick_checkout'" class="badge badge-blue" style="margin-left:4px">Quick</span>
            </td>
            <td>
              <button class="btn btn-sm btn-secondary" @click="copyLink(offer.id)">
                <Link2 :size="12" /> Copy
              </button>
              <button class="btn btn-sm btn-secondary" style="margin-left:4px" @click="openSendLink(offer)">
                <Send :size="12" /> Send
              </button>
            </td>
            <td style="white-space:nowrap">
              <router-link :to="`/offers/${offer.id}/edit`" class="btn btn-sm btn-secondary">
                <Edit :size="12" /> Edit
              </router-link>
              <button class="btn btn-sm btn-secondary" style="margin-left:4px" @click="cloneOffer(offer)">
                <Copy :size="12" /> Clone
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Send Link Modal -->
    <div v-if="showSendModal" class="modal-overlay" @click.self="showSendModal = false">
      <div class="modal-card">
        <h3 style="margin-bottom:4px">Send Enrollment Link</h3>
        <p class="text-sm text-muted mb-4">Sending link for: <strong>{{ sendForm.offerName }}</strong></p>

        <div class="form-group">
          <label class="form-label">First Name *</label>
          <input class="form-input" v-model="sendForm.firstName" placeholder="John" />
        </div>
        <div class="form-group">
          <label class="form-label">Last Name</label>
          <input class="form-input" v-model="sendForm.lastName" placeholder="Smith" />
        </div>
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input class="form-input" type="email" v-model="sendForm.email" placeholder="john@example.com" />
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-input" type="tel" v-model="sendForm.phone" placeholder="+15551234567" />
        </div>

        <div class="form-group">
          <label class="form-label">Send via:</label>
          <div class="flex gap-4" style="margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
              <input type="checkbox" v-model="sendForm.sendEmail" style="width:16px;height:16px;accent-color:#3b82f6" /> Email
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
              <input type="checkbox" v-model="sendForm.sendSms" style="width:16px;height:16px;accent-color:#3b82f6" /> SMS
            </label>
          </div>
        </div>

        <p class="text-sm text-muted mb-4">If this person is already a contact in your CRM, we'll use their existing record.</p>

        <div v-if="sendError" class="error-msg">{{ sendError }}</div>

        <div class="flex gap-2" style="justify-content:flex-end">
          <button class="btn btn-secondary" @click="showSendModal = false">Cancel</button>
          <button class="btn btn-primary" @click="submitSendLink" :disabled="sendLoading">
            <Send :size="14" /> {{ sendLoading ? 'Sending...' : 'Send Link' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Toast notifications -->
    <div v-if="toast" style="position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;padding:10px 20px;border-radius:6px;font-size:14px;z-index:200">
      {{ toast }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';
import { Plus, Package, Link2, Send, Edit, Copy } from 'lucide-vue-next';

const api = useApi();
const routerNav = useRouter();
const { loading, error } = api;
const offers = ref<any[]>([]);
const toast = ref('');

// Send link modal state
const showSendModal = ref(false);
const sendLoading = ref(false);
const sendError = ref('');
const sendForm = ref({
  offerId: '',
  offerName: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  sendEmail: true,
  sendSms: false,
});

onMounted(async () => {
  try {
    offers.value = await api.get<any[]>('/api/offers');
  } catch {}
});

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => { toast.value = ''; }, 3000);
}

async function copyLink(offerId: string) {
  try {
    const result = await api.get<{ link: string; funnelConfigured: boolean }>(`/api/offers/${offerId}/enrollment-link`);
    await navigator.clipboard.writeText(result.link);
    if (!result.funnelConfigured) {
      showToast('Link copied (set your funnel URL in Settings for production links)');
    } else {
      showToast('Enrollment link copied!');
    }
  } catch {}
}

async function cloneOffer(offer: any) {
  if (!confirm(`Clone '${offer.offer_name}'? This will create an inactive copy you can edit.`)) return;
  try {
    const result = await api.post<any>(`/api/offers/${offer.id}/clone`, {});
    if (result?.offer?.id) {
      routerNav.push(`/offers/${result.offer.id}/edit`);
    }
  } catch {}
}

// ─── Send Link ──────────────────────────────────────

function openSendLink(offer: any) {
  sendForm.value = {
    offerId: offer.id,
    offerName: offer.offer_name,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    sendEmail: true,
    sendSms: false,
  };
  sendError.value = '';
  showSendModal.value = true;
}

async function submitSendLink() {
  sendError.value = '';

  if (!sendForm.value.firstName) { sendError.value = 'First name is required'; return; }
  if (!sendForm.value.sendEmail && !sendForm.value.sendSms) { sendError.value = 'Select at least one send method'; return; }
  if (sendForm.value.sendEmail && !sendForm.value.email) { sendError.value = 'Email is required when sending via email'; return; }
  if (sendForm.value.sendSms && !sendForm.value.phone) { sendError.value = 'Phone is required when sending via SMS'; return; }

  sendLoading.value = true;
  try {
    const sendVia: string[] = [];
    if (sendForm.value.sendEmail) sendVia.push('email');
    if (sendForm.value.sendSms) sendVia.push('sms');

    await api.post('/api/enrollment/send-link', {
      offerId: sendForm.value.offerId,
      firstName: sendForm.value.firstName,
      lastName: sendForm.value.lastName,
      email: sendForm.value.email,
      phone: sendForm.value.phone,
      sendVia,
    });

    showSendModal.value = false;
    showToast(`Enrollment link sent to ${sendForm.value.email || sendForm.value.phone}`);
  } catch (err: any) {
    sendError.value = err?.message || 'Failed to send link. Please try again.';
  }
  sendLoading.value = false;
}

// TODO: Phase L+ — Add bulk send capability
// Select multiple contacts from GHL → send enrollment link to all
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  max-width: 440px;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}
</style>
