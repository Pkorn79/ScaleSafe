<template>
  <div>
    <SectionHeader
      eyebrow="Clients"
      :title="['Your', 'clients.']"
      description="Active enrollments, payment status, and last activity at a glance."
    >
      <template #actions>
        <button class="btn btn-primary btn-sm" @click="openAddClientModal">Add Client</button>
      </template>
    </SectionHeader>

    <!-- Active / Archive tabs -->
    <Tabs
      :model-value="statusGroup"
      @update:model-value="switchGroup"
      :tabs="statusGroupTabs"
      variant="segmented"
      class="mb-4"
    />

    <!-- Search + Filters -->
    <div class="flex gap-2 mb-4" style="flex-wrap:wrap">
      <input class="form-input" v-model="searchInput" @input="debouncedSearch" placeholder="Search by name or email..." style="flex:1;min-width:200px" />
      <select class="form-select" v-model="statusFilter" @change="loadClients" style="width:160px">
        <option value="">All Statuses</option>
        <option value="enrolled">Enrolled</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="cancelled">Cancelled</option>
        <option value="completed">Completed</option>
        <option value="consent_captured">Pending</option>
      </select>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading clients...</div>

    <!-- Summary -->
    <div v-if="!loading && totalClients > 0" class="text-sm text-muted mb-4">
      {{ totalClients }} client{{ totalClients !== 1 ? 's' : '' }}
      <span v-if="statusFilter"> - Filtered: {{ statusFilter }}</span>
      <span v-if="searchInput"> - Search: "{{ searchInput }}"</span>
    </div>

    <!-- Client Table -->
    <div class="card" v-if="clients.length > 0">
      <table class="table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Program</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Last Activity</th>
            <th>Payment Method</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.contactId || c.enrollmentId">
            <td>
              <router-link v-if="c.contactId" :to="`/clients/${c.contactId}`" style="color: var(--ss-primary-700); text-decoration: none">
                <strong>{{ c.name }}</strong>
              </router-link>
              <strong v-else>{{ c.name || 'Contact pending' }}</strong>
              <div v-if="c.email" class="text-sm text-muted">{{ c.email }}</div>
              <div v-if="!c.contactId" class="text-xs text-muted">Contact sync pending</div>
            </td>
            <td class="text-sm">{{ c.offerName || '-' }}</td>
            <td>
              <span class="badge" :class="statusBadge(c.status)">{{ c.status }}</span>
            </td>
            <td class="text-sm">
              <span v-if="c.paymentType === 'one_time'">${{ (c.paymentAmount || 0).toFixed(2) }} PIF</span>
              <span v-else-if="c.paymentType === 'installments' || c.paymentType === 'installment'">
                {{ c.paymentsMade || 0 }}/{{ c.paymentsTotal || '?' }}
              </span>
              <span v-else-if="c.paymentType === 'subscription'">Sub</span>
              <span v-else>-</span>
            </td>
            <td class="text-sm">{{ c.lastActivityDate ? formatDate(c.lastActivityDate) : '-' }}</td>
            <td>
              <span v-if="c.hasPaymentMethod || c.hasCard" class="badge badge-green" style="font-size:11px">Saved</span>
              <span v-else class="text-sm text-muted">-</span>
            </td>
            <td>
              <router-link v-if="c.contactId" :to="`/clients/${c.contactId}`" class="btn btn-sm btn-secondary">View</router-link>
              <span v-else class="text-sm text-muted">Pending</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="clients.length === 0 && !loading">
      <EmptyState
        v-if="searchInput || statusFilter"
        :icon="SearchX"
        title="No matches"
        body="No clients match your current filters. Try clearing the search or selecting a different status."
      />
      <EmptyState
        v-else-if="statusGroup === 'archive'"
        :icon="Archive"
        title="No archived clients"
        body="Archived clients appear here when you cancel a program. Active enrollments stay on the Active tab."
      />
      <EmptyState
        v-else
        :icon="Users"
        title="No clients yet"
        body="Send an enrollment link from any offer, or use Add Client for clients you've already onboarded outside ScaleSafe."
        cta-label="Add Client"
        @cta-click="openAddClientModal"
      />
    </div>

    <!-- Pagination -->
    <div v-if="totalClients > limit" class="flex-between mt-4">
      <button class="btn btn-sm btn-secondary" :disabled="page <= 1" @click="page--; loadClients()">Previous</button>
      <span class="text-sm text-muted">Page {{ page }} of {{ totalPages }}</span>
      <button class="btn btn-sm btn-secondary" :disabled="page >= totalPages" @click="page++; loadClients()">Next</button>
    </div>
    <!-- Add Client Modal -->
    <Modal v-model:open="showAddModal" title="Add Client">
      <div class="form-group">
        <label class="form-label">First Name *</label>
        <input class="form-input" v-model="newClient.firstName" placeholder="First name" />
      </div>
      <div class="form-group">
        <label class="form-label">Last Name</label>
        <input class="form-input" v-model="newClient.lastName" placeholder="Last name" />
      </div>
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input class="form-input" type="email" v-model="newClient.email" placeholder="client@example.com" />
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" type="tel" v-model="newClient.phone" placeholder="+1 (555) 000-0000" />
      </div>
      <label class="inline-check" style="margin-top:8px">
        <input type="checkbox" v-model="takePaymentNow" />
        Take payment now
      </label>
      <div v-if="addClientSuccess" class="text-sm mt-2" style="color:#047857">{{ addClientSuccess }}</div>
      <div v-if="addClientError" class="text-sm mt-2" style="color:#ef4444">{{ addClientError }}</div>
      <template #footer>
        <button class="btn btn-secondary" @click="showAddModal = false">Cancel</button>
        <button class="btn btn-primary" @click="submitAddClient" :disabled="addClientLoading">
          {{ addClientLoading ? 'Adding...' : (takePaymentNow ? 'Continue to Payment' : 'Add Client') }}
        </button>
      </template>
    </Modal>
    <QuickManualSaleModal
      v-model:open="showQuickSaleModal"
      :initial-client="quickSaleClient"
      @completed="onQuickSaleCompleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Users, SearchX, Archive } from 'lucide-vue-next';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import SectionHeader from '../components/SectionHeader.vue';
import Tabs from '../components/Tabs.vue';
import QuickManualSaleModal from '../components/QuickManualSaleModal.vue';

const api = useApi();
const { loading, error } = api;

const clients = ref<any[]>([]);
const totalClients = ref(0);
const page = ref(1);
const limit = ref(25);
const searchInput = ref('');
const statusFilter = ref('');
const statusGroup = ref('active');

// Add Client modal
const showAddModal = ref(false);
const addClientLoading = ref(false);
const addClientError = ref('');
const addClientSuccess = ref('');
const newClient = ref({ firstName: '', lastName: '', email: '', phone: '' });
const takePaymentNow = ref(false);
const showQuickSaleModal = ref(false);
const quickSaleClient = ref<any>(null);

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const totalPages = computed(() => Math.ceil(totalClients.value / limit.value) || 1);

const statusGroupTabs = [
  { key: 'active', label: 'Active' },
  { key: 'archive', label: 'Archive' },
  { key: 'all', label: 'All' },
];

function statusBadge(status: string): string {
  if (['enrolled', 'active'].includes(status)) return 'badge-green';
  if (status === 'completed') return 'badge-blue';
  if (status === 'cancelled') return 'badge-red';
  if (status === 'paused') return 'badge-yellow';
  return 'badge-gray';
}

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function debouncedSearch() {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { page.value = 1; loadClients(); }, 300);
}

function switchGroup(group: string) {
  statusGroup.value = group;
  statusFilter.value = '';
  page.value = 1;
  loadClients();
}

function openAddClientModal() {
  addClientError.value = '';
  addClientSuccess.value = '';
  showAddModal.value = true;
}

async function loadClients() {
  try {
    const params = new URLSearchParams();
    params.set('page', String(page.value));
    params.set('limit', String(limit.value));
    if (searchInput.value) params.set('search', searchInput.value);
    if (statusFilter.value) params.set('status', statusFilter.value);
    if (!statusFilter.value) params.set('statusGroup', statusGroup.value);

    const result = await api.get<any>(`/api/dashboard/clients?${params.toString()}`);
    clients.value = result.clients || [];
    totalClients.value = result.total || 0;
  } catch {
    clients.value = [];
    totalClients.value = 0;
    error.value = null;
  }
}

async function submitAddClient() {
  if (!newClient.value.firstName || !newClient.value.email) {
    addClientError.value = 'First name and email are required';
    return;
  }
  if (takePaymentNow.value) {
    quickSaleClient.value = { ...newClient.value };
    showAddModal.value = false;
    showQuickSaleModal.value = true;
    return;
  }
  addClientLoading.value = true;
  addClientError.value = '';
  addClientSuccess.value = '';
  try {
    const result = await api.post<any>('/api/dashboard/add-client', newClient.value);
    addClientSuccess.value = result?.message || (result?.matchedExisting ? 'Existing client matched and updated.' : 'Client added.');
    await loadClients();
    setTimeout(() => {
      showAddModal.value = false;
      addClientSuccess.value = '';
      newClient.value = { firstName: '', lastName: '', email: '', phone: '' };
      takePaymentNow.value = false;
    }, 900);
  } catch (e: any) {
    addClientError.value = e.message || 'Failed to add client';
  }
  addClientLoading.value = false;
}

function onQuickSaleCompleted() {
  showQuickSaleModal.value = false;
  newClient.value = { firstName: '', lastName: '', email: '', phone: '' };
  takePaymentNow.value = false;
  loadClients();
}

onMounted(() => loadClients());
</script>
