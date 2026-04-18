<template>
  <div>
    <div class="flex-between mb-2">
      <h1 class="page-title" style="margin-bottom:0">Clients</h1>
      <button class="btn btn-primary btn-sm" @click="showAddModal = true">Add Client</button>
    </div>

    <!-- Active / Archive tabs -->
    <div class="status-tabs mb-4">
      <button class="status-tab" :class="{ active: statusGroup === 'active' }" @click="switchGroup('active')">Active</button>
      <button class="status-tab" :class="{ active: statusGroup === 'archive' }" @click="switchGroup('archive')">Archive</button>
      <button class="status-tab" :class="{ active: statusGroup === 'all' }" @click="switchGroup('all')">All</button>
    </div>

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
      <span v-if="statusFilter"> · Filtered: {{ statusFilter }}</span>
      <span v-if="searchInput"> · Search: "{{ searchInput }}"</span>
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
            <th>Card</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.contactId">
            <td>
              <router-link :to="`/clients/${c.contactId}`" style="color:#3b82f6;text-decoration:none">
                <strong>{{ c.name }}</strong>
              </router-link>
              <div v-if="c.email" class="text-sm text-muted">{{ c.email }}</div>
            </td>
            <td class="text-sm">{{ c.offerName || '—' }}</td>
            <td>
              <span class="badge" :class="statusBadge(c.status)">{{ c.status }}</span>
            </td>
            <td class="text-sm">
              <span v-if="c.paymentType === 'one_time'">${{ (c.paymentAmount || 0).toFixed(2) }} PIF</span>
              <span v-else-if="c.paymentType === 'installments' || c.paymentType === 'installment'">
                {{ c.paymentsMade || 0 }}/{{ c.paymentsTotal || '?' }}
              </span>
              <span v-else-if="c.paymentType === 'subscription'">Sub</span>
              <span v-else>—</span>
            </td>
            <td class="text-sm">{{ c.lastActivityDate ? formatDate(c.lastActivityDate) : '—' }}</td>
            <td>
              <span v-if="c.hasCard" class="badge badge-green" style="font-size:11px">Card</span>
              <span v-else class="text-sm text-muted">—</span>
            </td>
            <td>
              <router-link :to="`/clients/${c.contactId}`" class="btn btn-sm btn-secondary">View</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="clients.length === 0 && !loading" class="empty-state">
      <p v-if="searchInput || statusFilter">No clients match your filters.</p>
      <p v-else-if="statusGroup === 'archive'">No archived clients yet.</p>
      <p v-else>No clients yet. Send an enrollment link to get started.</p>
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
      <div v-if="addClientError" class="text-sm mt-2" style="color:#ef4444">{{ addClientError }}</div>
      <template #footer>
        <button class="btn btn-secondary" @click="showAddModal = false">Cancel</button>
        <button class="btn btn-primary" @click="submitAddClient" :disabled="addClientLoading">
          {{ addClientLoading ? 'Adding...' : 'Add Client' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';

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
const newClient = ref({ firstName: '', lastName: '', email: '', phone: '' });

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

const totalPages = computed(() => Math.ceil(totalClients.value / limit.value) || 1);

function statusBadge(status: string): string {
  if (['enrolled', 'active'].includes(status)) return 'badge-green';
  if (status === 'completed') return 'badge-blue';
  if (status === 'cancelled') return 'badge-red';
  if (status === 'paused') return 'badge-yellow';
  return 'badge-gray';
}

function formatDate(d: string): string {
  if (!d) return '—';
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
  addClientLoading.value = true;
  addClientError.value = '';
  try {
    await api.post('/api/dashboard/add-client', newClient.value);
    showAddModal.value = false;
    newClient.value = { firstName: '', lastName: '', email: '', phone: '' };
    loadClients();
  } catch (e: any) {
    addClientError.value = e.message || 'Failed to add client';
  }
  addClientLoading.value = false;
}

onMounted(() => loadClients());
</script>

<style scoped>
.status-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e5e7eb;
}
.status-tab {
  padding: 8px 20px;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  background: none;
  border: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
}
.status-tab:hover {
  color: #1e293b;
}
.status-tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}
</style>
