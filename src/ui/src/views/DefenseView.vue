<template>
  <div>
    <SectionHeader
      eyebrow="Defense"
      :title="['Chargeback', 'cases.']"
      description="Track active disputes, win rate, and total revenue defended."
    >
      <template #actions>
        <button class="btn btn-primary" @click="showCompile = true">New Defense</button>
      </template>
    </SectionHeader>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <!-- Summary Cards -->
    <div v-if="summary" class="grid grid-4 mb-4">
      <Stat label="Total Cases" :value="summary.total" accent="navy" />
      <Stat label="Won" :value="summary.won" accent="emerald" />
      <Stat label="Win Rate" :value="`${summary.winRate}%`" accent="emerald" />
      <Stat label="Value Recovered" :value="`$${(summary.totalValueSaved || 0).toLocaleString()}`" accent="emerald" />
    </div>

    <!-- Filters -->
    <div class="flex-between mb-4" style="flex-wrap:wrap;gap:12px">
      <Tabs v-model="activeFilter" :tabs="filters" variant="pill" />
      <select class="form-select" style="width:auto;padding:5px 10px;font-size:12px" v-model="sortBy">
        <option value="deadline">Sort: Deadline (soonest)</option>
        <option value="created">Sort: Date Created</option>
        <option value="amount">Sort: Amount</option>
      </select>
    </div>

    <!-- Packet Cards -->
    <div v-if="filteredPackets.length === 0 && !loading">
      <EmptyState
        :icon="ShieldCheck"
        :title="activeFilter === 'all' ? 'No defense packets yet' : 'No matches'"
        :body="emptyBody"
        :cta-label="activeFilter === 'all' ? 'New Defense' : ''"
        @cta-click="showCompile = true"
      />
    </div>

    <div v-for="p in filteredPackets" :key="p.id" class="defense-card" @click="$router.push(`/defense/${p.id}`)">
      <div class="flex-between" style="margin-bottom:8px">
        <div>
          <strong style="font-size:14px">{{ p.contactName || 'Unknown' }}</strong>
          <span class="badge" :class="lifecycleBadge(p.lifecycleStatus || p.lifecycle_status || 'pending_submission')" style="margin-left:8px">
            {{ humanizeEventType(p.lifecycleStatus || p.lifecycle_status || 'pending_submission') }}
          </span>
        </div>
        <div class="text-sm text-muted">{{ formatTimestamp(p.created_at, 'short') }}</div>
      </div>
      <div class="grid grid-4" style="gap:8px">
        <div class="text-sm"><strong>Amount:</strong> ${{ Number(p.dispute_amount || 0).toFixed(2) }}</div>
        <div class="text-sm">
          <span class="badge badge-blue">{{ p.reason_code }}</span>
          <span class="text-muted" style="margin-left:6px">{{ humanizeReasonCode(p.reason_code) }}</span>
        </div>
        <div class="text-sm"><strong>Deadline:</strong> {{ formatTimestamp(p.deadline, 'short') }}</div>
        <div class="text-sm">
          <span v-if="p.outcome" class="badge" :class="p.outcome.outcome === 'won' ? 'badge-green' : 'badge-red'">
            {{ humanizeEventType(p.outcome.outcome) }}
          </span>
          <span v-else-if="(p.lifecycleStatus || p.lifecycle_status) === 'submitted'" class="text-muted">Awaiting decision</span>
        </div>
      </div>
      <div v-if="daysUntil(p.deadline) !== null" class="text-sm mt-2"
        :style="{ color: daysUntil(p.deadline)! <= 3 ? '#b91c1c' : daysUntil(p.deadline)! <= 7 ? '#b45309' : 'var(--ss-navy-500)' }">
        {{ daysUntil(p.deadline)! > 0 ? pluralize(daysUntil(p.deadline), 'day') + ' remaining' : daysUntil(p.deadline) === 0 ? 'Due today' : 'Overdue by ' + pluralize(Math.abs(daysUntil(p.deadline)!), 'day') }}
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

      <!-- Transaction selector (loads after customer is selected) -->
      <div v-if="compileForm.contactId" class="form-group">
        <label class="form-label">Disputed Transaction</label>
        <div v-if="transactionsLoading" class="text-sm text-muted">Loading transactions...</div>
        <select v-else class="form-select" v-model="selectedTransactionId" @change="onTransactionSelected">
          <option value="">Manual entry (no specific transaction)</option>
          <option v-for="t in transactions" :key="t.id" :value="t.id">
            {{ formatTimestamp(t.date, 'short') }} - ${{ Number(t.amount || 0).toFixed(2) }}{{ t.offerName ? ' - ' + t.offerName : '' }}{{ t.transactionId ? ' - ' + maskTransactionId(t.transactionId) : '' }}
          </option>
        </select>
        <div v-if="transactions.length === 0 && !transactionsLoading && compileForm.contactId" class="text-sm text-muted mt-2">
          No transactions found for this client. You can still file a defense with manual entry.
        </div>
        <div v-if="transactionScopeWarning" class="text-sm mt-2" style="color: #b45309;">
          ⚠️ {{ transactionScopeWarning }}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Reason Code *</label>
        <select class="form-select" v-model="compileForm.reasonCode">
          <option value="">Select...</option>
          <option value="10.4">10.4 - Fraud (Visa)</option>
          <option value="13.1">13.1 - Services Not Provided (Visa)</option>
          <option value="13.3">13.3 - Not As Described (Visa)</option>
          <option value="13.6">13.6 - Credit Not Processed (Visa)</option>
          <option value="10.1">10.1 - Authorization (Visa)</option>
          <option value="4837">4837 - Fraud (MC)</option>
          <option value="4855">4855 - Services Not Provided (MC)</option>
          <option value="4853">4853 - Not As Described (MC)</option>
          <option value="4860">4860 - Credit Not Processed (MC)</option>
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
import { ShieldCheck } from 'lucide-vue-next';
import { useApi } from '../composables/useApi';
import Modal from '../components/Modal.vue';
import Stat from '../components/Stat.vue';
import EmptyState from '../components/EmptyState.vue';
import SectionHeader from '../components/SectionHeader.vue';
import Tabs from '../components/Tabs.vue';
import { humanizeEventType, humanizeReasonCode, maskTransactionId, formatTimestamp, pluralize } from '../utils/humanize';

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
const emptyBody = computed(() =>
  activeFilter.value === 'all'
    ? 'When a chargeback comes in, compile a defense packet here. ScaleSafe pulls evidence from the client timeline automatically.'
    : 'No defense packets match this filter. Try clearing it or selecting a different status.',
);

const compileForm = ref({
  contactId: '',
  reasonCode: '',
  disputeAmount: 0,
  disputeDate: '',
  deadline: '',
  caseNumber: '',
  addressee: '',
  paymentEventId: '',
  enrollmentId: '',
});

// Transaction selector state
const transactions = ref<Array<{ id: string; date: string; amount: number; transactionId: string; offerName: string; enrollmentId: string; offerId: string }>>([]);
const transactionsLoading = ref(false);
const selectedTransactionId = ref('');

// Warn when a transaction is selected but isn't linked to a specific program.
// The backend will still scope by the payment event, but it may fall back to
// contact-wide (needs-review) evidence — so surface that instead of silently
// sending an empty enrollmentId.
const transactionScopeWarning = computed(() => {
  const txId = selectedTransactionId.value;
  if (!txId) return '';
  const tx = transactions.value.find(t => t.id === txId);
  if (tx && !tx.enrollmentId) {
    return 'This transaction isn’t linked to a specific program. ScaleSafe will try to match it to one from the transaction itself; if it can’t, the packet will be scoped to the whole client and marked "needs review" before it can be submitted.';
  }
  return '';
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
  } catch (err: any) {
    error.value = err.message || 'Failed to load defense packets.';
  }
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

async function selectCustomer(customer: { contactId: string; name?: string; email?: string }) {
  compileForm.value.contactId = customer.contactId;
  customerSearch.value = customer.name || customer.email || customer.contactId;
  showCustomerDropdown.value = false;

  // Fetch transactions for the selected customer
  selectedTransactionId.value = '';
  compileForm.value.paymentEventId = '';
  compileForm.value.enrollmentId = '';
  transactionsLoading.value = true;
  try {
    const data = await api.get<any>(`/api/defense/transactions/${encodeURIComponent(customer.contactId)}`);
    transactions.value = data?.transactions || [];
  } catch {
    transactions.value = [];
  }
  transactionsLoading.value = false;
}

function onTransactionSelected() {
  const txId = selectedTransactionId.value;
  if (!txId) {
    // Manual entry fallback - clear auto-filled fields
    compileForm.value.paymentEventId = '';
    compileForm.value.enrollmentId = '';
    return;
  }
  const tx = transactions.value.find(t => t.id === txId);
  if (tx) {
    compileForm.value.paymentEventId = tx.id;
    compileForm.value.enrollmentId = tx.enrollmentId || '';
    compileForm.value.disputeAmount = tx.amount || compileForm.value.disputeAmount;
  }
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
  border: 1px solid var(--ss-navy-200);
  border-radius: 16px;
  padding: 16px 20px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.defense-settings-preview {
  background: var(--ss-cream-50);
}

.settings-stub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}

.defense-card:hover {
  border-color: var(--ss-primary-500);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.10);
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
