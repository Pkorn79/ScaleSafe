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
          <span v-if="p.status && p.status !== 'complete'" class="badge" :class="statusBadge(p.status)" style="margin-left:6px">
            {{ humanizeEventType(p.status) }}
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
          <optgroup v-for="group in REASON_CODE_GROUPS" :key="group.network" :label="group.label">
            <option v-for="rc in group.codes" :key="rc.code" :value="rc.code">
              {{ rc.code }} - {{ rc.name }}
            </option>
          </optgroup>
        </select>
        <div v-if="selectedNetwork" class="text-sm text-muted mt-2">
          {{ selectedNetwork.label }} response window: {{ selectedNetwork.days }} days from the dispute date.
        </div>
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

// Reason codes grouped by network, mirroring src/constants/reason-codes.ts.
// Days = the network's merchant response window (Visa 30, MC 45, Amex 20,
// Discover ~20 conservative) — an Amex deadline defaulted past day 20 is a
// default loss, so the deadline must follow the selected code's network.
const REASON_CODE_GROUPS = [
  {
    network: 'visa', label: 'Visa', days: 30,
    codes: [
      { code: '10.1', name: 'Authorization — EMV Liability Shift' },
      { code: '10.4', name: 'Fraud — Card-Absent' },
      { code: '11.3', name: 'No Authorization' },
      { code: '12.5', name: 'Incorrect Amount' },
      { code: '12.6.1', name: 'Duplicate Processing' },
      { code: '12.6.2', name: 'Paid by Other Means' },
      { code: '13.1', name: 'Services Not Provided' },
      { code: '13.2', name: 'Canceled Recurring' },
      { code: '13.3', name: 'Not As Described' },
      { code: '13.5', name: 'Misrepresentation' },
      { code: '13.6', name: 'Credit Not Processed' },
      { code: '13.7', name: 'Canceled Services' },
    ],
  },
  {
    network: 'mastercard', label: 'Mastercard', days: 45,
    codes: [
      { code: '4808', name: 'Authorization' },
      { code: '4834', name: 'Point-of-Interaction Error / Duplicate' },
      { code: '4837', name: 'Fraud — No Cardholder Authorization' },
      { code: '4841', name: 'Canceled Recurring / Digital Goods' },
      { code: '4853', name: 'Cardholder Dispute / Not As Described' },
      { code: '4855', name: 'Services Not Provided' },
      { code: '4860', name: 'Credit Not Processed' },
    ],
  },
  {
    network: 'amex', label: 'American Express', days: 20,
    codes: [
      { code: 'A02', name: 'No Valid Authorization' },
      { code: 'C02', name: 'Credit Not Processed' },
      { code: 'C05', name: 'Goods/Services Canceled' },
      { code: 'C08', name: 'Goods/Services Not Received' },
      { code: 'C14', name: 'Paid by Other Means' },
      { code: 'C28', name: 'Canceled Recurring Billing' },
      { code: 'C31', name: 'Not As Described' },
      { code: 'C32', name: 'Damaged or Defective' },
      { code: 'F29', name: 'Fraud — Card Not Present' },
      { code: 'P08', name: 'Duplicate Charge' },
    ],
  },
  {
    network: 'discover', label: 'Discover', days: 20,
    codes: [
      { code: 'AA', name: 'Does Not Recognize' },
      { code: 'AP', name: 'Canceled Recurring Payment' },
      { code: 'RG', name: 'Non-Receipt of Goods/Services' },
      { code: 'RM', name: 'Quality Dispute' },
      { code: 'RN2', name: 'Credit Not Received' },
      { code: 'UA', name: 'Fraud — Card Not Present' },
    ],
  },
];

const selectedNetwork = computed(() => {
  const code = compileForm.value.reasonCode;
  if (!code) return null;
  const group = REASON_CODE_GROUPS.find(g => g.codes.some(c => c.code === code));
  return group ? { label: group.label, days: group.days } : null;
});

function recomputeDeadline() {
  const disputeDate = compileForm.value.disputeDate;
  if (!disputeDate) { compileForm.value.deadline = ''; return; }
  // Default to the strictest window (20 days) when the network is unknown —
  // better to prompt the merchant early than to blow a real deadline.
  const days = selectedNetwork.value?.days ?? 20;
  const deadline = new Date(disputeDate);
  deadline.setDate(deadline.getDate() + days);
  compileForm.value.deadline = deadline.toISOString().slice(0, 10);
}

watch(() => compileForm.value.disputeDate, recomputeDeadline);
// Changing the reason code changes the network window, so re-derive the deadline.
watch(() => compileForm.value.reasonCode, () => {
  if (compileForm.value.disputeDate) recomputeDeadline();
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

// Compilation status badge — only rendered on cards when status !== 'complete'
// so finished packets stay uncluttered while stuck/held ones stand out.
function statusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-yellow', processing: 'badge-blue',
    failed: 'badge-red', needs_review: 'badge-orange',
  };
  return map[status] || 'badge-gray';
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
