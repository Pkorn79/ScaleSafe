<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Defense Dashboard</h1>
      <button class="btn btn-primary" @click="showCompile = true">New Defense</button>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Summary Cards -->
    <div v-if="summary" class="grid grid-4 mb-4">
      <div class="card">
        <div class="card-title">Total Cases</div>
        <div class="card-value">{{ summary.total }}</div>
      </div>
      <div class="card">
        <div class="card-title">Won</div>
        <div class="card-value" style="color:#10b981">{{ summary.won }}</div>
      </div>
      <div class="card">
        <div class="card-title">Win Rate</div>
        <div class="card-value">{{ summary.winRate }}%</div>
      </div>
      <div class="card">
        <div class="card-title">Value Saved</div>
        <div class="card-value" style="color:#10b981">${{ (summary.totalValueSaved || 0).toLocaleString() }}</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex gap-2 mb-4" style="flex-wrap:wrap">
      <button v-for="f in filters" :key="f.key" class="btn btn-sm"
        :class="activeFilter === f.key ? 'btn-primary' : 'btn-secondary'" @click="activeFilter = f.key">
        {{ f.label }}
      </button>
      <select class="form-select" style="width:auto;padding:5px 10px;font-size:12px;margin-left:auto" v-model="sortBy">
        <option value="deadline">Sort: Deadline (soonest)</option>
        <option value="created">Sort: Date Created</option>
        <option value="amount">Sort: Amount</option>
      </select>
    </div>

    <!-- Packet Cards -->
    <div v-if="filteredPackets.length === 0 && !loading" class="empty-state">
      <p>No defense packets{{ activeFilter !== 'all' ? ' matching this filter' : '' }}.</p>
    </div>

    <div v-for="p in filteredPackets" :key="p.id" class="defense-card" @click="$router.push(`/defense/${p.id}`)">
      <div class="flex-between" style="margin-bottom:8px">
        <div>
          <strong style="font-size:14px">{{ p.contact_id?.slice(0, 12) }}...</strong>
          <span class="badge" :class="lifecycleBadge(p.lifecycleStatus || p.lifecycle_status || 'pending_submission')" style="margin-left:8px">
            {{ p.lifecycleStatus || p.lifecycle_status || 'pending_submission' }}
          </span>
        </div>
        <div class="text-sm text-muted">{{ formatDate(p.created_at) }}</div>
      </div>
      <div class="grid grid-4" style="gap:8px">
        <div class="text-sm"><strong>Amount:</strong> ${{ Number(p.dispute_amount || 0).toFixed(2) }}</div>
        <div class="text-sm"><span class="badge badge-blue">{{ p.reason_code }}</span></div>
        <div class="text-sm"><strong>Deadline:</strong> {{ formatDate(p.deadline) }}</div>
        <div class="text-sm">
          <span v-if="p.outcome" class="badge" :class="p.outcome.outcome === 'won' ? 'badge-green' : 'badge-red'">
            {{ p.outcome.outcome }}
          </span>
          <span v-else-if="p.lifecycleStatus === 'submitted' || (p.lifecycle_status === 'submitted')" class="text-muted">Awaiting decision</span>
        </div>
      </div>
      <div v-if="daysUntil(p.deadline) !== null" class="text-sm mt-2"
        :style="{ color: daysUntil(p.deadline)! <= 3 ? '#ef4444' : daysUntil(p.deadline)! <= 7 ? '#f59e0b' : '#6b7280' }">
        {{ daysUntil(p.deadline)! > 0 ? daysUntil(p.deadline) + ' days remaining' : daysUntil(p.deadline) === 0 ? 'Due today' : 'Overdue by ' + Math.abs(daysUntil(p.deadline)!) + ' days' }}
      </div>
    </div>

    <!-- Compile Modal -->
    <Modal v-model:open="showCompile" title="Compile Defense Packet">
      <div v-if="compileError" class="error-msg" style="margin-bottom:12px">{{ compileError }}</div>

      <div class="form-group" style="position:relative">
        <label class="form-label">Customer *</label>
        <input class="form-input" v-model="customerSearch" placeholder="Search by name or email..."
          @focus="showCustomerDropdown = true" @input="onCustomerSearchInput" />
        <div v-if="showCustomerDropdown" class="customer-dropdown">
          <div v-if="customerSearchLoading" class="customer-option text-sm text-muted">Searching...</div>
          <button v-for="customer in customerResults" :key="customer.contactId" type="button" class="customer-option" @mousedown.prevent="selectCustomer(customer)">
            <div class="text-sm"><strong>{{ customer.name || customer.email || customer.contactId }}</strong></div>
            <div class="text-sm text-muted">{{ customer.email || '' }}</div>
          </button>
          <div v-if="!customerSearchLoading && customerSearch.trim().length >= 3 && customerResults.length === 0" class="customer-option text-sm text-muted">No matching customers</div>
          <div v-if="!customerSearchLoading && customerSearch.trim().length < 3" class="customer-option text-sm text-muted">Type at least 3 characters</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Reason Code *</label>
        <select class="form-select" v-model="compileForm.reasonCode">
          <option value="">Select...</option>
          <option value="10.4">10.4 — Fraud (Visa)</option>
          <option value="13.1">13.1 — Services Not Provided (Visa)</option>
          <option value="13.3">13.3 — Not As Described (Visa)</option>
          <option value="13.6">13.6 — Credit Not Processed (Visa)</option>
          <option value="10.1">10.1 — Authorization (Visa)</option>
          <option value="4837">4837 — Fraud (MC)</option>
          <option value="4855">4855 — Services Not Provided (MC)</option>
          <option value="4853">4853 — Not As Described (MC)</option>
          <option value="4860">4860 — Credit Not Processed (MC)</option>
        </select>
      </div>
      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Dispute Amount *</label>
          <input class="form-input" type="number" step="0.01" v-model.number="compileForm.disputeAmount" />
        </div>
        <div class="form-group">
          <label class="form-label">Case/ARN Number</label>
          <input class="form-input" v-model="compileForm.caseNumber" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Dispute Date *</label>
        <input class="form-input" type="date" v-model="compileForm.disputeDate" />
        <div v-if="compileForm.deadline" class="text-sm text-muted mt-2">
          Response deadline: {{ formatDate(compileForm.deadline) }}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Addressee (optional)</label>
        <input class="form-input" v-model="compileForm.addressee" placeholder="e.g., Stripe Disputes Team, Bank of America Chargeback Dept" />
        <div class="text-sm text-muted mt-2">Leave blank for a default based on your processor.</div>
      </div>

      <template #footer>
        <button class="btn btn-secondary" @click="showCompile = false">Cancel</button>
        <button class="btn btn-primary" @click="compile" :disabled="compiling">
          {{ compiling ? 'Submitting...' : 'Compile Defense' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';

const api = useApi();
const routerNav = useRouter();
const { loading, error } = api;

const packets = ref<any[]>([]);
const summary = ref<any>(null);
const showCompile = ref(false);
const compiling = ref(false);
const compileError = ref<string | null>(null);
const customerSearch = ref('');
const customerResults = ref<Array<{ contactId: string; name?: string; email?: string }>>([]);
const customerSearchLoading = ref(false);
const showCustomerDropdown = ref(false);
let customerSearchTimer: ReturnType<typeof setTimeout> | null = null;

const activeFilter = ref('all');
const sortBy = ref('deadline');

const filters = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'pending_outcome', label: 'Pending Outcome' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
  { key: 'withdrawn', label: 'Withdrawn' },
];

const compileForm = ref({
  contactId: '',
  reasonCode: '',
  disputeAmount: 0,
  disputeDate: '',
  deadline: '',
  caseNumber: '',
  addressee: '',
});

watch(() => compileForm.value.disputeDate, (disputeDate) => {
  if (!disputeDate) { compileForm.value.deadline = ''; return; }
  const deadline = new Date(disputeDate);
  deadline.setDate(deadline.getDate() + 21);
  compileForm.value.deadline = deadline.toISOString().slice(0, 10);
});

const filteredPackets = computed(() => {
  let list = [...packets.value];
  // Filter
  if (activeFilter.value === 'active') {
    list = list.filter(p => ['pending_submission', 'submitted'].includes(p.lifecycleStatus || p.lifecycle_status || ''));
  } else if (activeFilter.value === 'pending_outcome') {
    list = list.filter(p => (p.lifecycleStatus || p.lifecycle_status) === 'submitted');
  } else if (['won', 'lost', 'withdrawn'].includes(activeFilter.value)) {
    list = list.filter(p => (p.lifecycleStatus || p.lifecycle_status) === activeFilter.value);
  }
  // Sort
  list.sort((a, b) => {
    if (sortBy.value === 'deadline') {
      return new Date(a.deadline || 0).getTime() - new Date(b.deadline || 0).getTime();
    }
    if (sortBy.value === 'amount') {
      return Number(b.dispute_amount || 0) - Number(a.dispute_amount || 0);
    }
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
  return list;
});

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function lifecycleBadge(ls: string): string {
  if (ls === 'pending_submission') return 'badge-yellow';
  if (ls === 'submitted') return 'badge-blue';
  if (ls === 'won') return 'badge-green';
  if (ls === 'lost') return 'badge-red';
  if (ls === 'withdrawn') return 'badge-gray';
  return 'badge-gray';
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

onMounted(async () => {
  try {
    const data = await api.get<any>('/api/dashboard/defense-history');
    packets.value = data?.packets || [];
    summary.value = data?.summary || null;
  } catch {}
});

// Customer search
function onCustomerSearchInput() {
  compileForm.value.contactId = '';
  if (customerSearchTimer) clearTimeout(customerSearchTimer);
  const query = customerSearch.value.trim();
  if (query.length < 3) { customerResults.value = []; showCustomerDropdown.value = true; return; }
  customerSearchTimer = setTimeout(async () => {
    customerSearchLoading.value = true;
    try {
      const data = await api.get<{ customers: Array<{ contactId: string; name?: string; email?: string }> }>(
        `/api/payments/customers?search=${encodeURIComponent(query)}`,
      );
      customerResults.value = data?.customers || [];
    } catch { customerResults.value = []; }
    customerSearchLoading.value = false;
    showCustomerDropdown.value = true;
  }, 400);
}

function selectCustomer(customer: { contactId: string; name?: string; email?: string }) {
  compileForm.value.contactId = customer.contactId;
  customerSearch.value = customer.name || customer.email || customer.contactId;
  showCustomerDropdown.value = false;
}

async function compile() {
  compiling.value = true;
  compileError.value = null;
  try {
    if (!compileForm.value.contactId) throw new Error('Please select a customer');
    if (!compileForm.value.deadline) throw new Error('Please select a dispute date');
    const result = await api.post<any>('/api/defense/compile', compileForm.value);
    showCompile.value = false;
    routerNav.push(`/defense/${result.defenseId}`);
  } catch (e: any) {
    compileError.value = e.message;
  }
  compiling.value = false;
}
</script>

<style scoped>
.defense-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.15s;
}

.defense-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.08);
}

.customer-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 0 0 8px 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  max-height: 200px;
  overflow-y: auto;
  z-index: 20;
}

.customer-option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border: none;
  background: none;
  cursor: pointer;
}

.customer-option:hover {
  background: #f1f5f9;
}
</style>
