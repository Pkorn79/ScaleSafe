<template>
  <div>
    <SectionHeader
      eyebrow="Offers"
      :title="['Your', 'offers.']"
      description="Programs you sell. Each offer carries its own price, payment terms, and consent flow."
    >
      <template #actions>
        <router-link to="/offers/new" class="btn btn-primary">
          <Plus :size="16" /> New Offer
        </router-link>
      </template>
    </SectionHeader>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading offers...</div>

    <div v-if="offers.length === 0 && !loading">
      <EmptyState
        :icon="Package"
        title="No offers yet"
        body="Create your first offer to start enrolling clients. Each offer carries its own price, payment terms, and consent flow."
        cta-label="New Offer"
        @cta-click="routerNav.push('/offers/new')"
      />
    </div>

    <!-- Tab filter -->
    <Tabs
      v-if="offers.length > 0"
      v-model="tab"
      :tabs="offerTabs"
      variant="segmented"
      class="mb-4"
    />

    <div v-if="offerFeatureSettings.length > 0" class="card offer-settings-preview">
      <div class="flex-between mb-4">
        <div>
          <h3 class="section-title" style="margin-bottom:4px">Offer Settings Preview</h3>
          <p class="text-sm text-muted">Future offer controls are shown here so merchants know where they will live.</p>
        </div>
        <router-link to="/roadmap" class="btn btn-sm btn-secondary">Roadmap</router-link>
      </div>
      <div class="settings-stub-grid">
        <FeatureSettingStub v-for="feature in offerFeatureSettings" :key="feature.id" :feature="feature" />
      </div>
    </div>

    <div class="card" v-if="filteredOffers.length > 0">
      <table class="table">
        <thead>
          <tr>
            <th>Offer Name</th>
            <th>Tracking ID</th>
            <th>Price</th>
            <th>Payment</th>
            <th>Processor</th>
            <th>Status</th>
            <th>Link</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="offer in filteredOffers" :key="offer.id">
            <td>
              <strong>{{ offer.offer_name }}</strong>
              <div class="text-sm text-muted">{{ offer.delivery_method || 'Not set' }}</div>
            </td>
            <td>
              <span v-if="offer.tracking_id" class="tracking-id">{{ offer.tracking_id }}</span>
              <span v-else class="text-sm text-muted">-</span>
            </td>
            <td>${{ offer.price || 0 }}</td>
            <td>
              <span class="badge" :class="offer.payment_type === 'one_time' ? 'badge-blue' : offer.payment_type === 'subscription' ? 'badge-yellow' : 'badge-green'">
                {{ offer.payment_type === 'one_time' ? 'Pay in Full' : offer.payment_type === 'subscription' ? `$${offer.installment_amount || offer.price}/${offer.installment_frequency || 'mo'}` : `${offer.num_payments}x $${offer.installment_amount}` }}
              </span>
            </td>
            <td>
              <span class="badge" :class="offer.processor_override === 'nmi' ? 'badge-blue' : offer.processor_override === 'stripe' ? 'badge-purple' : 'badge-gray'">
                {{ offer.processor_override === 'nmi' ? 'NMI' : offer.processor_override === 'stripe' ? 'Stripe' : 'Default' }}
              </span>
            </td>
            <td>
              <span class="badge" :class="offer.active ? 'badge-green' : 'badge-gray'">
                {{ offer.active ? 'Active' : 'Inactive' }}
              </span>
              <span v-if="offer.checkout_mode === 'quick_checkout'" class="badge badge-blue" style="margin-left:4px">Quick</span>
            </td>
            <td>
              <button class="btn btn-sm btn-secondary" @click="copyLink(offer.id)" :disabled="copyingOfferId === offer.id">
                <Link2 :size="12" /> {{ copyingOfferId === offer.id ? 'Copying...' : 'Copy' }}
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
              <button v-if="offer.active" class="btn btn-sm btn-secondary" style="margin-left:4px" @click="archiveOffer(offer)">
                Archive
              </button>
              <button v-else class="btn btn-sm btn-success" style="margin-left:4px" @click="unarchiveOffer(offer)">
                Activate
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Send Link Modal -->
    <Modal v-model:open="showSendModal" title="Send Enrollment Link">
      <p class="text-sm text-muted mb-4" style="margin-top:-4px">Sending link for: <strong>{{ sendForm.offerName }}</strong></p>

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
            <input type="checkbox" v-model="sendForm.sendEmail" style="width:16px;height:16px;accent-color:#10b981" /> Email
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
            <input type="checkbox" v-model="sendForm.sendSms" style="width:16px;height:16px;accent-color:#10b981" /> SMS
          </label>
        </div>
      </div>

      <p class="text-sm text-muted">If this person is already a contact in your CRM, we'll use their existing record.</p>

      <div v-if="sendError" class="error-msg" style="margin-top:8px">{{ sendError }}</div>

      <template #footer>
        <button class="btn btn-secondary" @click="showSendModal = false">Cancel</button>
        <button class="btn btn-primary" @click="submitSendLink" :disabled="sendLoading">
          <Send :size="14" /> {{ sendLoading ? 'Sending...' : 'Send Link' }}
        </button>
      </template>
    </Modal>

    <!-- Toast notifications -->
    <div v-if="toast" style="position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;padding:10px 20px;border-radius:6px;font-size:14px;z-index:200">
      {{ toast }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';
import { Plus, Package, Link2, Send, Edit, Copy } from 'lucide-vue-next';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import SectionHeader from '../components/SectionHeader.vue';
import Tabs from '../components/Tabs.vue';
import FeatureSettingStub from '../components/FeatureSettingStub.vue';
import { getFeaturesByArea } from '../lib/featureCatalog';

const api = useApi();
const routerNav = useRouter();
const { loading, error } = api;
const offers = ref<any[]>([]);
const toast = ref('');
const copyingOfferId = ref('');
const tab = ref<'active' | 'archived'>('active');
const activeOffers = computed(() => offers.value.filter(o => o.active));
const archivedOffers = computed(() => offers.value.filter(o => !o.active));
const filteredOffers = computed(() => tab.value === 'active' ? activeOffers.value : archivedOffers.value);
const offerTabs = computed(() => [
  { key: 'active', label: 'Active', count: activeOffers.value.length },
  { key: 'archived', label: 'Archived', count: archivedOffers.value.length },
]);
const offerFeatureSettings = getFeaturesByArea('offers')
  .filter(feature => !['checkout-upsells', 'source-closer-tracking'].includes(feature.id));

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
  } catch (err: any) {
    showToast(err?.message || 'Could not load offers.');
  }
});

function showToast(msg: string) {
  toast.value = msg;
  setTimeout(() => { toast.value = ''; }, 3000);
}

async function copyLink(offerId: string) {
  copyingOfferId.value = offerId;
  try {
    const result = await api.get<{ link: string; funnelConfigured: boolean }>(`/api/offers/${offerId}/enrollment-link`);
    if (!result.funnelConfigured) {
      showToast('Add your Enrollment Funnel URL in Settings before copying this link.');
      return;
    }
    await navigator.clipboard.writeText(result.link);
    showToast('Enrollment link copied!');
  } catch (err: any) {
    showToast(err?.message || 'Could not copy enrollment link.');
  } finally {
    copyingOfferId.value = '';
  }
}

async function cloneOffer(offer: any) {
  if (!confirm(`Clone '${offer.offer_name}'? This will create an inactive copy you can edit.`)) return;
  try {
    const result = await api.post<any>(`/api/offers/${offer.id}/clone`, {});
    if (result?.offer?.id) {
      routerNav.push(`/offers/${result.offer.id}/edit`);
    }
  } catch (err: any) {
    showToast(err?.message || 'Could not clone offer.');
  }
}

// --- Send Link --------------------------------------

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

async function archiveOffer(offer: any) {
  if (!confirm(`Archive '${offer.offer_name}'? It will be deactivated and hidden from clients.`)) return;
  try {
    await api.put(`/api/offers/${offer.id}`, { active: false });
    offer.active = false;
    showToast('Offer archived');
  } catch (err: any) {
    showToast(err?.message || 'Could not archive offer.');
  }
}

async function unarchiveOffer(offer: any) {
  try {
    await api.put(`/api/offers/${offer.id}`, { active: true });
    offer.active = true;
    showToast('Offer activated');
  } catch (err: any) {
    showToast(err?.message || 'Could not activate offer.');
  }
}

// TODO: Phase L+ - Add bulk send capability
// Select multiple contacts from GHL -> send enrollment link to all
</script>

<style scoped>
.section-title {
  font-size: 16px;
  font-weight: 650;
}

.offer-settings-preview {
  background: var(--ss-cream-50);
}

.settings-stub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}

.tracking-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--ss-navy-700);
}
</style>
