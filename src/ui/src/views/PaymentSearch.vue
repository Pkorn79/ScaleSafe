<template>
  <div>
    <div class="flex-between mb-4">
      <div>
        <h1 class="page-title" style="margin-bottom:4px">Payments</h1>
        <p class="text-sm text-muted">Review charges, refunds, failures, processors, and program attribution.</p>
      </div>
    </div>

    <div class="payment-roadmap mb-4">
      <router-link v-for="feature in paymentRoadmap" :key="feature.id" :to="`/roadmap/${feature.id}`" class="payment-roadmap-card">
        <div>
          <strong>{{ feature.title }}</strong>
          <span>{{ feature.summary }}</span>
        </div>
        <FeatureStatusPill :status="feature.status" />
      </router-link>
    </div>

    <div class="card payment-settings-preview">
      <div class="flex-between mb-4">
        <div>
          <div class="card-title" style="margin-bottom:4px">Payment Settings Preview</div>
          <p class="text-sm text-muted">These options are visible now as planned controls. Disabled items are not active yet.</p>
        </div>
        <router-link to="/settings/payments" class="btn btn-sm btn-secondary">Processor Settings</router-link>
      </div>
      <div class="settings-stub-grid">
        <FeatureSettingStub v-for="feature in paymentFeatureSettings" :key="feature.id" :feature="feature" />
      </div>
    </div>

    <div class="payment-tabs mb-4">
      <button class="tab-btn" :class="{ active: activeTab === 'ledger' }" @click="activeTab = 'ledger'">
        All Payments
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'clients' }" @click="activeTab = 'clients'">
        Clients
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'reconciliation' }" @click="activeTab = 'reconciliation'">
        Reconciliation
      </button>
    </div>

    <section v-if="activeTab === 'ledger'">
      <div class="card">
        <div class="ledger-filters">
          <div class="filter-wide">
            <label class="form-label">Search</label>
              <input
              class="form-input"
              v-model="ledgerFilters.search"
              placeholder="Client, email, contact ID, or program"
              @keyup.enter="applyLedgerFilters"
            />
          </div>
          <div>
            <label class="form-label">Tracking ID</label>
            <input
              class="form-input"
              v-model="ledgerFilters.trackingId"
              placeholder="Rep, campaign, source"
              @keyup.enter="applyLedgerFilters"
            />
          </div>
          <div>
            <label class="form-label">Processor</label>
            <select class="form-select" v-model="ledgerFilters.processor" @change="applyLedgerFilters">
              <option value="">All</option>
              <option value="stripe">Stripe</option>
              <option value="nmi">NMI</option>
              <option value="ghl">GHL</option>
            </select>
          </div>
          <div>
            <label class="form-label">Billing</label>
            <select class="form-select" v-model="ledgerFilters.paymentType" @change="applyLedgerFilters">
              <option value="">All</option>
              <option value="pif">PIF</option>
              <option value="installment">Installment</option>
              <option value="subscription">Subscription</option>
              <option value="free">Free</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label class="form-label">Status</label>
            <select class="form-select" v-model="ledgerFilters.status" @change="applyLedgerFilters">
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div>
            <label class="form-label">From</label>
            <input class="form-input" type="date" v-model="ledgerFilters.from" @change="applyLedgerFilters" />
          </div>
          <div>
            <label class="form-label">To</label>
            <input class="form-input" type="date" v-model="ledgerFilters.to" @change="applyLedgerFilters" />
          </div>
          <div class="filter-actions">
            <button class="btn btn-primary" @click="applyLedgerFilters" :disabled="ledgerLoading">
              {{ ledgerLoading ? 'Loading...' : 'Apply' }}
            </button>
            <button class="btn btn-secondary" @click="resetLedgerFilters" :disabled="ledgerLoading">Reset</button>
          </div>
        </div>
      </div>

      <div v-if="ledgerError" class="error-msg">{{ ledgerError }}</div>

      <div class="grid grid-3 mb-4">
        <div class="card metric-card">
          <div class="card-title">Visible Charges</div>
          <div class="card-value">${{ Number(ledgerSummary.totalCharged || 0).toFixed(2) }}</div>
        </div>
        <div class="card metric-card">
          <div class="card-title">Visible Refunds</div>
          <div class="card-value">${{ Number(ledgerSummary.totalRefunded || 0).toFixed(2) }}</div>
        </div>
        <div class="card metric-card">
          <div class="card-title">Visible Failed</div>
          <div class="card-value">${{ Number(ledgerSummary.failedAmount || 0).toFixed(2) }}</div>
        </div>
      </div>

      <div class="card ledger-card">
        <div class="flex-between mb-4">
          <div class="card-title" style="margin-bottom:0">Payment Ledger</div>
          <div class="text-sm text-muted">{{ ledgerTotal }} result{{ ledgerTotal === 1 ? '' : 's' }}</div>
        </div>
        <div v-if="ledgerLoading" class="loading">Loading payments...</div>
        <div v-else-if="ledgerRows.length === 0" class="empty-state">
          <p>No payments match these filters.</p>
        </div>
        <div v-else class="table-scroll">
          <table class="table ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client</th>
                <th>Program</th>
                <th>Tracking ID</th>
                <th>Billing</th>
                <th>Processor</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Source</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in ledgerRows" :key="row.id">
                <td class="nowrap">{{ formatDate(row.date) }}</td>
                <td>
                  <router-link v-if="row.contactId" :to="`/payments/${row.contactId}`" class="client-link">
                    {{ row.customerName || row.customerEmail || row.contactId }}
                  </router-link>
                  <span v-else>{{ row.customerName || 'Unknown' }}</span>
                  <div v-if="row.customerEmail" class="text-xs text-muted">{{ row.customerEmail }}</div>
                </td>
                <td>
                  {{ row.programName }}
                  <div v-if="row.paymentNumber" class="text-xs text-muted">
                    Payment {{ row.paymentNumber }}<span v-if="row.paymentsRemaining === 0">, final</span>
                  </div>
                </td>
                <td class="tracking-cell">{{ row.offerTrackingId || '-' }}</td>
                <td><span class="badge badge-gray">{{ row.paymentTypeLabel }}</span></td>
                <td><span class="badge" :class="processorBadge(row.processor)">{{ processorLabel(row.processor) }}</span></td>
                <td class="nowrap">${{ Number(row.amount || 0).toFixed(2) }}</td>
                <td><span class="badge" :class="statusBadge(row.status)">{{ row.statusLabel }}</span></td>
                <td class="text-sm">{{ sourceLabel(row.source, row.isRecurring) }}</td>
                <td class="txn-cell">{{ row.processorTransactionId || row.processorSubscriptionId || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="ledgerRows.length > 0" class="flex-between mt-4">
          <button class="btn btn-secondary" @click="prevLedgerPage" :disabled="ledgerLoading || ledgerOffset === 0">Previous</button>
          <div class="text-sm text-muted">Showing {{ ledgerOffset + 1 }}-{{ Math.min(ledgerOffset + ledgerRows.length, ledgerTotal) }}</div>
          <button class="btn btn-secondary" @click="nextLedgerPage" :disabled="ledgerLoading || ledgerOffset + ledgerLimit >= ledgerTotal">Next</button>
        </div>
      </div>
    </section>

    <section v-else-if="activeTab === 'clients'">
      <div class="card" style="max-width:720px">
        <div class="flex gap-2 mb-4">
          <input class="form-input" v-model="searchQuery" placeholder="Search by name, email, or contact ID..."
            @keyup.enter="search" style="flex:1" />
          <button class="btn btn-primary" @click="search" :disabled="loading">Search</button>
        </div>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="loading" class="loading">Searching...</div>

      <div v-if="customers.length === 0 && searched && !loading" class="empty-state">
        <p>No customers with payment history found.</p>
      </div>

      <div v-for="c in customers" :key="c.contactId" class="card customer-card">
        <div class="flex-between">
          <div>
            <strong>{{ c.name || c.email || c.contactId.slice(0, 12) + '...' }}</strong>
            <div v-if="c.email && c.name" class="text-sm text-muted">{{ c.email }}</div>
            <div v-if="c.programName" class="text-sm text-muted">{{ c.programName }}</div>
            <div class="text-sm text-muted">
              ${{ c.totalCharged.toFixed(2) }} charged
              <span v-if="c.totalRefunded > 0"> &middot; ${{ c.totalRefunded.toFixed(2) }} refunded</span>
              <span v-if="c.lastPaymentDate"> &middot; Last: {{ formatDateShort(c.lastPaymentDate) }}</span>
            </div>
          </div>
          <router-link :to="`/payments/${c.contactId}`" class="btn btn-sm btn-primary">
            Manage Payments
          </router-link>
        </div>
      </div>
    </section>

    <section v-else>
      <div class="card">
        <div class="flex-between">
          <div>
            <div class="card-title" style="margin-bottom:4px">Payment Reconciliation</div>
            <p class="text-sm text-muted">
              Flags records that make processor truth hard to prove: missing subscription IDs, processor mismatches, overdue billing, duplicates, unassigned payments, and recent failures.
            </p>
          </div>
          <div class="reconcile-actions">
            <select class="form-select" v-model="reconciliationDays" @change="loadReconciliation">
              <option :value="7">7 days</option>
              <option :value="30">30 days</option>
              <option :value="90">90 days</option>
              <option :value="365">365 days</option>
            </select>
            <button class="btn btn-primary" @click="loadReconciliation" :disabled="reconciliationLoading">
              {{ reconciliationLoading ? 'Checking...' : 'Run Check' }}
            </button>
            <button class="btn btn-secondary" @click="syncNmiHistory()" :disabled="nmiSyncLoading">
              {{ nmiSyncLoading ? 'Importing...' : 'Manual NMI Import' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="reconciliationError" class="error-msg">{{ reconciliationError }}</div>
      <div v-if="nmiSyncMessage" class="text-sm mb-4" style="color:#047857">{{ nmiSyncMessage }}</div>

      <div class="grid grid-4 mb-4">
        <div class="card metric-card">
          <div class="card-title">Open Issues</div>
          <div class="card-value">{{ reconciliationSummary.issueCount || 0 }}</div>
        </div>
        <div class="card metric-card">
          <div class="card-title">High Priority</div>
          <div class="card-value">{{ reconciliationSummary.high || 0 }}</div>
        </div>
        <div class="card metric-card">
          <div class="card-title">Active Recurring</div>
          <div class="card-value">{{ reconciliationSummary.activeRecurringEnrollments || 0 }}</div>
        </div>
        <div class="card metric-card">
          <div class="card-title">Events Scanned</div>
          <div class="card-value">{{ reconciliationSummary.paymentEventsScanned || 0 }}</div>
          <div class="text-xs text-muted">{{ reconciliationSummary.nmiSilentPostLogsScanned || 0 }} NMI postbacks</div>
        </div>
      </div>

      <div class="card ledger-card">
        <div class="flex-between mb-4">
          <div>
            <div class="card-title" style="margin-bottom:0">NMI Recurring Diagnostics</div>
            <div class="text-sm text-muted">Shows whether ScaleSafe received, matched, and recorded NMI recurring payments.</div>
          </div>
          <button class="btn btn-sm btn-secondary" @click="loadNmiDiagnostics" :disabled="nmiDiagnosticsLoading">
            {{ nmiDiagnosticsLoading ? 'Loading...' : 'Refresh' }}
          </button>
        </div>
        <div v-if="nmiDiagnosticsLoading" class="loading">Loading NMI diagnostics...</div>
        <div v-else-if="nmiDiagnostics.length === 0" class="empty-state">
          <p>No NMI recurring enrollments found.</p>
        </div>
        <div v-else class="table-scroll">
          <table class="table reconcile-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Client</th>
                <th>Program</th>
                <th>Subscription</th>
                <th>Progress</th>
                <th>Last ScaleSafe Payment</th>
                <th>Last NMI Post</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in nmiDiagnostics" :key="row.enrollmentId">
              <tr>
                <td><span class="badge" :class="nmiIssueBadge(row.issueCode)">{{ row.issueLabel }}</span></td>
                <td>
                  <router-link v-if="row.contactId" :to="`/payments/${row.contactId}`" class="client-link">
                    {{ row.customerName || row.customerEmail || row.contactId }}
                  </router-link>
                  <span v-else>{{ row.customerName || 'Unknown' }}</span>
                  <div v-if="row.customerEmail" class="text-xs text-muted">{{ row.customerEmail }}</div>
                </td>
                <td>
                  {{ row.programName || 'Unknown Program' }}
                  <div class="text-xs text-muted">{{ row.paymentType }} / {{ row.status }}</div>
                </td>
                <td class="txn-cell">{{ row.subscriptionId || '-' }}</td>
                <td>
                  {{ row.paymentsMade || 0 }} of {{ row.paymentsTotal || '?' }}
                  <div v-if="row.nextBillingDate" class="text-xs text-muted">Next: {{ formatDateShort(row.nextBillingDate) }}</div>
                </td>
                <td>
                  <span v-if="row.lastScaleSafePaymentDate">
                    {{ formatDate(row.lastScaleSafePaymentDate) }}
                    <span v-if="row.lastScaleSafePaymentAmount != null"> / ${{ Number(row.lastScaleSafePaymentAmount).toFixed(2) }}</span>
                  </span>
                  <span v-else>-</span>
                  <div v-if="row.lastScaleSafeTransactionId" class="text-xs text-muted txn-cell">{{ row.lastScaleSafeTransactionId }}</div>
                </td>
                <td>
                  <span v-if="row.lastNmiPostDate">{{ formatDate(row.lastNmiPostDate) }}</span>
                  <span v-else>-</span>
                  <div v-if="row.lastNmiPostAction" class="text-xs text-muted">{{ row.lastNmiPostAction }}</div>
                  <div v-if="row.lastNmiPostTransactionId" class="text-xs text-muted txn-cell">{{ row.lastNmiPostTransactionId }}</div>
                  <button
                    class="btn btn-sm btn-secondary mt-1"
                    @click="loadNmiTrace(row)"
                    :disabled="nmiTraceLoading === row.enrollmentId"
                  >
                    {{ nmiTraceLoading === row.enrollmentId ? 'Tracing...' : 'Trace' }}
                  </button>
                  <button
                    v-if="row.issueCode !== 'billing_complete'"
                    class="btn btn-sm btn-secondary mt-1"
                    @click="syncNmiHistory(row.enrollmentId)"
                    :disabled="nmiSyncLoading"
                  >
                    Manual Import
                  </button>
                </td>
              </tr>
              <tr v-if="selectedNmiTraceEnrollment === row.enrollmentId">
                <td colspan="7">
                  <div class="trace-panel">
                    <div v-if="nmiTrace.summary" class="trace-summary">
                      {{ nmiTrace.summary.issue }}
                    </div>
                    <div class="trace-grid">
                      <div>
                        <div class="text-sm font-semibold">Webhook logs</div>
                        <div v-if="!nmiTrace.logs?.length" class="text-xs text-muted">No logs found.</div>
                        <div v-for="log in nmiTrace.logs || []" :key="log.id" class="trace-line">
                          {{ formatDate(log.created_at) }} - {{ log.event_type || log.webhook_kind || 'NMI post' }} - {{ log.action || '-' }}
                          <div class="text-xs text-muted">{{ log.transaction_id || '-' }} - signature {{ log.signature_verified === true ? 'verified' : log.signature_verified === false ? 'not verified' : 'n/a' }}</div>
                        </div>
                      </div>
                      <div>
                        <div class="text-sm font-semibold">ScaleSafe payments</div>
                        <div v-if="!nmiTrace.payments?.length" class="text-xs text-muted">No payment records found.</div>
                        <div v-for="payment in nmiTrace.payments || []" :key="payment.id" class="trace-line">
                          {{ formatDate(payment.created_at) }} - {{ payment.event_type }} - ${{ Number(payment.amount || 0).toFixed(2) }}
                          <div class="text-xs text-muted">{{ payment.processor_transaction_id || '-' }} - {{ payment.source || '-' }}</div>
                        </div>
                      </div>
                      <div>
                        <div class="text-sm font-semibold">Receipt trigger</div>
                        <div v-if="!nmiTrace.receiptTriggers?.length" class="text-xs text-muted">No recent receipt trigger logs.</div>
                        <div v-for="trigger in nmiTrace.receiptTriggers || []" :key="trigger.id" class="trace-line">
                          {{ formatDate(trigger.created_at) }} - {{ trigger.status || '-' }} - HTTP {{ trigger.http_status || '-' }}
                          <div v-if="trigger.error_message" class="text-xs text-muted">{{ trigger.error_message }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card ledger-card">
        <div class="flex-between mb-4">
          <div class="card-title" style="margin-bottom:0">Reconciliation Issues</div>
          <div class="text-sm text-muted">
            Checked {{ reconciliationReport?.checkedAt ? formatDate(reconciliationReport.checkedAt) : '-' }}
          </div>
        </div>
        <div v-if="reconciliationLoading" class="loading">Checking payment records...</div>
        <div v-else-if="reconciliationIssues.length === 0" class="empty-state">
          <p>No reconciliation issues found for this window.</p>
        </div>
        <div v-else class="table-scroll">
          <table class="table reconcile-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Issue</th>
                <th>Client</th>
                <th>Program</th>
                <th>Processor</th>
                <th>Amount</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="issue in reconciliationIssues" :key="issue.id">
                <td><span class="badge" :class="priorityBadge(issue.priority)">{{ issue.priority }}</span></td>
                <td>
                  <strong>{{ issue.title }}</strong>
                  <div class="text-xs text-muted">{{ issue.detail }}</div>
                </td>
                <td>
                  <router-link v-if="issue.contactId" :to="`/payments/${issue.contactId}`" class="client-link">
                    {{ issue.customerName || issue.customerEmail || issue.contactId }}
                  </router-link>
                  <span v-else>{{ issue.customerName || 'Unknown' }}</span>
                  <div v-if="issue.customerEmail" class="text-xs text-muted">{{ issue.customerEmail }}</div>
                </td>
                <td>
                  {{ issue.programName || 'Unassigned' }}
                  <div v-if="issue.paymentType" class="text-xs text-muted">{{ issue.paymentType }}</div>
                </td>
                <td><span class="badge" :class="processorBadge(issue.processor)">{{ processorLabel(issue.processor) }}</span></td>
                <td class="nowrap">{{ issue.amount == null ? '-' : `$${Number(issue.amount || 0).toFixed(2)}` }}</td>
                <td class="txn-cell">{{ issue.transactionId || issue.subscriptionId || issue.enrollmentId || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useApi } from '../composables/useApi';
import FeatureStatusPill from '../components/FeatureStatusPill.vue';
import FeatureSettingStub from '../components/FeatureSettingStub.vue';
import { getFeaturesByArea, publicFeatureCatalog } from '../lib/featureCatalog';

const api = useApi();
const { loading, error } = api;

const activeTab = ref<'ledger' | 'clients' | 'reconciliation'>('ledger');

const paymentRoadmap = publicFeatureCatalog.filter((feature) => [
  'nmi-multi-mid',
  'ach',
  'whop',
  'digistore24',
].includes(feature.id));
const paymentFeatureSettings = [
  ...getFeaturesByArea('payments'),
  ...publicFeatureCatalog.filter((feature) => ['whop', 'digistore24'].includes(feature.id)),
];

const searchQuery = ref('');
const customers = ref<any[]>([]);
const searched = ref(false);

const ledgerRows = ref<any[]>([]);
const ledgerSummary = ref<any>({ totalCharged: 0, totalRefunded: 0, failedAmount: 0 });
const ledgerTotal = ref(0);
const ledgerLimit = 50;
const ledgerOffset = ref(0);
const ledgerLoading = ref(false);
const ledgerError = ref('');
const ledgerFilters = ref({
  search: '',
  trackingId: '',
  processor: '',
  paymentType: '',
  status: '',
  from: '',
  to: '',
});

const reconciliationReport = ref<any | null>(null);
const reconciliationSummary = ref<any>({ issueCount: 0, high: 0, medium: 0, low: 0, activeRecurringEnrollments: 0, paymentEventsScanned: 0 });
const reconciliationIssues = ref<any[]>([]);
const reconciliationLoading = ref(false);
const reconciliationError = ref('');
const reconciliationDays = ref(30);
const nmiDiagnostics = ref<any[]>([]);
const nmiDiagnosticsLoading = ref(false);
const nmiSyncLoading = ref(false);
const nmiSyncMessage = ref('');
const selectedNmiTraceEnrollment = ref('');
const nmiTraceLoading = ref('');
const nmiTrace = ref<any>({ logs: [], payments: [], receiptTriggers: [], enrollments: [] });

onMounted(async () => {
  await loadLedger();
});

watch(activeTab, async (tab) => {
  if (tab === 'clients' && !searched.value) await search();
  if (tab === 'reconciliation' && !reconciliationReport.value) await loadReconciliation();
});

function formatDate(d: string) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function processorLabel(proc: string): string {
  if (proc === 'nmi') return 'NMI';
  if (proc === 'stripe') return 'Stripe';
  if (proc === 'ghl') return 'GHL';
  return proc || 'Unknown';
}

function processorBadge(proc: string): string {
  if (proc === 'nmi') return 'badge-blue';
  if (proc === 'stripe') return 'badge-gray';
  if (proc === 'ghl') return 'badge-yellow';
  return 'badge-gray';
}

function statusBadge(status: string): string {
  if (status === 'paid' || status === 'created') return 'badge-green';
  if (status === 'failed' || status === 'cancelled') return 'badge-red';
  if (status === 'refunded') return 'badge-yellow';
  return 'badge-gray';
}

function priorityBadge(priority: string): string {
  if (priority === 'high') return 'badge-red';
  if (priority === 'medium') return 'badge-yellow';
  return 'badge-gray';
}

function nmiIssueBadge(issueCode: string): string {
  if (['no_post_received', 'unmatched_subscription', 'verification_failed', 'payment_record_failed', 'overdue_tracking'].includes(issueCode)) return 'badge-red';
  if (issueCode === 'imported_successfully') return 'badge-green';
  if (issueCode === 'billing_complete' || issueCode === 'ok') return 'badge-blue';
  return 'badge-yellow';
}

function sourceLabel(source: string, recurring: boolean): string {
  if (source === 'nmi_history_sync') return 'NMI history sync';
  if (source === 'nmi_silent_post') return 'NMI Silent Post';
  if (source === 'nmi_webhook_event') return 'NMI webhook';
  const value = source || (recurring ? 'recurring' : 'checkout');
  return value.replace(/_/g, ' ');
}

function dateBoundary(value: string, endOfDay = false): string {
  const time = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  return new Date(`${value}${time}`).toISOString();
}

// #32: monotonic request sequence — on a financial reconciliation screen, an earlier ledger
// request that resolves after a later one must not overwrite the newer rows/summary/total.
let ledgerLoadSeq = 0;
async function loadLedger() {
  const seq = ++ledgerLoadSeq;
  ledgerLoading.value = true;
  ledgerError.value = '';
  try {
    const params = new URLSearchParams();
    params.set('limit', String(ledgerLimit));
    params.set('offset', String(ledgerOffset.value));
    for (const [key, value] of Object.entries(ledgerFilters.value)) {
      if (!value) continue;
      if (key === 'from') params.set(key, dateBoundary(value));
      else if (key === 'to') params.set(key, dateBoundary(value, true));
      else params.set(key, value);
    }
    const result = await api.get<any>(`/api/payments/manage/ledger?${params.toString()}`);
    if (seq !== ledgerLoadSeq) return; // a newer request superseded this one
    ledgerRows.value = result?.payments || [];
    ledgerSummary.value = result?.summary || { totalCharged: 0, totalRefunded: 0, failedAmount: 0 };
    ledgerTotal.value = result?.total || ledgerRows.value.length;
  } catch (e: any) {
    if (seq !== ledgerLoadSeq) return;
    ledgerError.value = e.message || 'Failed to load payment ledger';
  } finally {
    if (seq === ledgerLoadSeq) ledgerLoading.value = false;
  }
}

async function applyLedgerFilters() {
  ledgerOffset.value = 0;
  await loadLedger();
}

async function resetLedgerFilters() {
  ledgerFilters.value = { search: '', trackingId: '', processor: '', paymentType: '', status: '', from: '', to: '' };
  ledgerOffset.value = 0;
  await loadLedger();
}

async function nextLedgerPage() {
  ledgerOffset.value += ledgerLimit;
  await loadLedger();
}

async function prevLedgerPage() {
  ledgerOffset.value = Math.max(0, ledgerOffset.value - ledgerLimit);
  await loadLedger();
}

async function search() {
  try {
    searched.value = true;
    const params = searchQuery.value ? `?search=${encodeURIComponent(searchQuery.value)}` : '';
    const result = await api.get<any>(`/api/payments/manage/customers${params}`);
    customers.value = result?.customers || [];
  } catch {}
}

async function loadReconciliation() {
  reconciliationLoading.value = true;
  reconciliationError.value = '';
  try {
    const [result] = await Promise.all([
      api.get<any>(`/api/payments/manage/reconciliation?days=${reconciliationDays.value}`),
      loadNmiDiagnostics(),
    ]);
    reconciliationReport.value = result || null;
    reconciliationSummary.value = result?.summary || { issueCount: 0, high: 0, medium: 0, low: 0, activeRecurringEnrollments: 0, paymentEventsScanned: 0 };
    reconciliationIssues.value = result?.issues || [];
  } catch (e: any) {
    reconciliationError.value = e.message || 'Failed to load payment reconciliation';
  } finally {
    reconciliationLoading.value = false;
  }
}

async function loadNmiDiagnostics() {
  nmiDiagnosticsLoading.value = true;
  try {
    const result = await api.get<any>('/api/payments/manage/nmi-diagnostics');
    nmiDiagnostics.value = result?.rows || [];
  } catch {
    nmiDiagnostics.value = [];
  } finally {
    nmiDiagnosticsLoading.value = false;
  }
}

async function syncNmiHistory(enrollmentId?: string) {
  const scope = enrollmentId ? 'this enrollment' : 'all visible NMI recurring enrollments';
  const confirmed = confirm(`Manual NMI import checks processor history for ${scope}. It records missing approved/failed NMI transactions, but it does not charge cards and does not send customer receipts. Continue?`);
  if (!confirmed) return;

  nmiSyncLoading.value = true;
  nmiSyncMessage.value = '';
  reconciliationError.value = '';
  try {
    const result = await api.post<any>('/api/payments/manage/sync/nmi-recurring', enrollmentId ? { enrollmentId } : {});
    if (enrollmentId) {
      nmiSyncMessage.value = `Manual NMI import checked ${result?.checked || 0} transactions, imported ${result?.imported || 0}.`;
    } else {
      const imported = (result?.results || []).reduce((sum: number, row: any) => sum + Number(row.imported || 0), 0);
      nmiSyncMessage.value = `Manual NMI import checked ${result?.checked || 0} enrollments, imported ${imported} payments.`;
    }
    await loadReconciliation();
  } catch (e: any) {
    reconciliationError.value = e.message || 'NMI history sync failed';
  } finally {
    nmiSyncLoading.value = false;
  }
}

async function loadNmiTrace(row: any) {
  if (selectedNmiTraceEnrollment.value === row.enrollmentId) {
    selectedNmiTraceEnrollment.value = '';
    nmiTrace.value = { logs: [], payments: [], receiptTriggers: [], enrollments: [] };
    return;
  }

  selectedNmiTraceEnrollment.value = row.enrollmentId;
  nmiTraceLoading.value = row.enrollmentId;
  reconciliationError.value = '';
  try {
    const params = new URLSearchParams();
    if (row.enrollmentId) params.set('enrollmentId', row.enrollmentId);
    if (row.subscriptionId) params.set('subscriptionId', row.subscriptionId);
    const result = await api.get<any>(`/api/payments/manage/nmi-webhook-trace?${params.toString()}`);
    nmiTrace.value = result || { logs: [], payments: [], receiptTriggers: [], enrollments: [] };
  } catch (e: any) {
    reconciliationError.value = e.message || 'NMI webhook trace failed';
  } finally {
    nmiTraceLoading.value = '';
  }
}
</script>

<style scoped>
.payment-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--ss-navy-200);
  border-radius: 10px;
}

.payment-roadmap {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
}

.payment-settings-preview {
  background: var(--ss-cream-50);
}

.settings-stub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}

.payment-roadmap-card {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid var(--ss-navy-200);
  border-radius: 10px;
  background: #fff;
  color: inherit;
  text-decoration: none;
}

.payment-roadmap-card strong {
  display: block;
  color: var(--ss-navy-900);
  font-size: 13px;
  margin-bottom: 3px;
}

.payment-roadmap-card span {
  display: block;
  color: var(--ss-navy-500);
  font-size: 12px;
  line-height: 1.45;
}

.tab-btn {
  border: 0;
  background: transparent;
  color: var(--ss-navy-600);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--ss-primary-50);
  color: var(--ss-primary-800);
}

.ledger-filters {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) repeat(6, minmax(130px, 1fr)) auto;
  gap: 12px;
  align-items: end;
}

.filter-actions {
  display: flex;
  gap: 8px;
}

.reconcile-actions {
  display: flex;
  align-items: end;
  gap: 8px;
}

.metric-card {
  margin-bottom: 0;
}

.ledger-card {
  overflow: hidden;
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
}

.ledger-table {
  min-width: 1240px;
}

.reconcile-table {
  min-width: 1180px;
}

.nowrap {
  white-space: nowrap;
}

.client-link {
  color: var(--ss-primary-700);
  font-weight: 600;
  text-decoration: none;
}

.client-link:hover {
  text-decoration: underline;
}

.txn-cell {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.tracking-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.customer-card {
  max-width: 720px;
}

.text-xs {
  font-size: 12px;
}

.font-semibold {
  font-weight: 600;
}

.trace-panel {
  background: var(--ss-bg-subtle, #f8fafc);
  border: 1px solid var(--ss-border, #e2e8f0);
  border-radius: 6px;
  padding: 12px;
}

.trace-summary {
  background: #fff;
  border: 1px solid var(--ss-border, #e2e8f0);
  border-radius: 6px;
  color: var(--ss-navy-700);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  padding: 10px 12px;
}

.trace-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 12px;
}

.trace-line {
  border-top: 1px solid var(--ss-border, #e2e8f0);
  font-size: 12px;
  padding: 8px 0;
}

@media (max-width: 980px) {
  .ledger-filters {
    grid-template-columns: 1fr 1fr;
  }
  .filter-wide,
  .filter-actions {
    grid-column: 1 / -1;
  }

  .reconcile-actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .trace-grid {
    grid-template-columns: 1fr;
  }
}
</style>
