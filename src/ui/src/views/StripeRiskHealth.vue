<template>
  <div class="defense-dashboard">
    <SectionHeader
      eyebrow="Defense"
      :title="['Stripe', 'health.']"
      description="Visibility into your dispute rate, evidence coverage, and account health."
    />

    <!-- Loading state -->
    <div v-if="pageLoading" class="loading">Loading account health data...</div>

    <!-- No Stripe connected -->
    <div v-else-if="!stripeConnected" class="empty-state">
      <h3>Connect Stripe to See Your Defense Dashboard</h3>
      <p class="text-sm text-muted mb-4">Get instant visibility into your dispute rate, evidence coverage, and account health.</p>
      <router-link to="/settings/payments" class="btn btn-primary">Connect Stripe</router-link>
    </div>

    <!-- Dashboard content -->
    <div v-else>
      <!-- Risk Level Banner -->
      <div class="risk-banner mb-4" :class="'risk-banner-' + riskLevel">
        <span class="text-sm">Account Risk Level:</span>
        <strong style="margin-left:8px;font-size:16px">{{ riskLevel.toUpperCase() }}</strong>
      </div>

      <div v-if="healthStatusIncomplete" class="health-status-warning mb-4">
        Stripe health classifications are unavailable for this snapshot. Refresh data before relying on the risk labels.
      </div>

      <!-- Key Metrics Grid -->
      <div class="grid grid-3 mb-4">
        <div class="card">
          <div class="card-title">Dispute Rate (30d)</div>
          <div class="card-value" :class="disputeRateClass">
            {{ healthSnapshot.dispute_rate != null ? (healthSnapshot.dispute_rate * 100).toFixed(2) + '%' : 'N/A' }}
          </div>
          <div class="text-sm text-muted mt-2">Visa VAMP: 0.65% | MC: 0.75%</div>
        </div>

        <div class="card">
          <div class="card-title">Early Fraud Warnings (30d)</div>
          <div class="card-value">{{ healthSnapshot.total_efws || 0 }}</div>
          <a v-if="unansweredEfwCount > 0" href="#efw-queue" class="text-sm" style="color:#dc2626;font-weight:500">
            {{ unansweredEfwCount }} awaiting your response ↓
          </a>
        </div>

        <div class="card">
          <div class="card-title">Dispute Recovery Rate</div>
          <div class="card-value">
            {{ healthSnapshot.recovery_rate != null ? (healthSnapshot.recovery_rate * 100).toFixed(0) + '%' : 'N/A' }}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Evidence Completeness</div>
          <div class="card-value">{{ healthSnapshot.avg_evidence_score || 0 }}%</div>
        </div>

        <div class="card">
          <div class="card-title">Open Dispute Exposure</div>
          <div class="card-value">
            ${{ ((healthSnapshot.financial_exposure_cents || 0) / 100).toFixed(2) }}
          </div>
        </div>

        <div class="card">
          <div class="card-title">Transactions (30d)</div>
          <div class="card-value">{{ healthSnapshot.total_charges || 0 }}</div>
        </div>
      </div>

      <!-- VAMP Status -->
      <div class="card">
        <h3 class="section-title">Network Monitoring Status</h3>
        <div class="grid grid-2">
          <div>
            <span class="text-sm"><strong>Visa VAMP:</strong></span>
            <span class="text-sm" :class="'vamp-status-' + vampStatus" style="margin-left:8px">
              {{ formatVampStatus(vampStatus) }}
            </span>
          </div>
          <div>
            <span class="text-sm"><strong>Mastercard:</strong></span>
            <span class="text-sm" :class="'mc-status-' + mcStatus" style="margin-left:8px">
              {{ formatMcStatus(mcStatus) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Early Fraud Warnings queue: the pre-dispute refund election. A card
           issuer reported suspected fraud; refunding now usually prevents the
           formal dispute + fee (the fraud report still counts toward VAMP). -->
      <div v-if="efws.length > 0" id="efw-queue" class="card">
        <h3 class="section-title">
          Early Fraud Warnings
          <span v-if="unansweredEfwCount > 0" class="badge badge-red" style="margin-left:8px">{{ unansweredEfwCount }} unanswered</span>
        </h3>
        <p class="text-sm text-muted mb-4">
          A card issuer flagged these charges as suspected fraud — most fraud chargebacks start here.
          Refunding usually prevents the dispute and its fee. Either way, the fraud report itself
          still counts toward Visa's monitoring thresholds, so prevention matters most.
        </p>
        <div style="overflow-x:auto">
          <table class="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Charge</th>
                <th>Fraud Type</th>
                <th>Recommendation</th>
                <th>Respond By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in efws" :key="e.id">
                <td class="text-sm">{{ formatDate(e.created_at) }}</td>
                <td class="text-sm">
                  {{ e.stripe_charge_id || e.stripe_payment_intent_id || '--' }}
                  <span v-if="e.amount"> (${{ Number(e.amount).toFixed(2) }})</span>
                </td>
                <td><span class="badge badge-blue">{{ formatFraudType(e.fraud_type) }}</span></td>
                <td>
                  <span class="badge" :class="e.recommendation === 'refund' ? 'badge-yellow' : 'badge-green'">
                    {{ (e.recommendation || 'review').toUpperCase() }}
                  </span>
                  <div v-if="e.recommendation_reason" class="text-sm text-muted" style="max-width:340px">{{ e.recommendation_reason }}</div>
                </td>
                <td class="text-sm">{{ e.responded ? '--' : formatDate(e.response_deadline) }}</td>
                <td>
                  <span v-if="e.responded" class="badge" :class="e.response_action === 'refunded' ? 'badge-gray' : 'badge-green'">
                    {{ e.response_action === 'refunded' ? 'Refunded' : 'Holding' }}
                  </span>
                  <div v-else class="flex gap-2">
                    <button class="btn btn-sm btn-primary" :disabled="respondingEfwId === e.id" @click="respondEfw(e, 'refund')">
                      {{ respondingEfwId === e.id ? '...' : 'Refund' }}
                    </button>
                    <button class="btn btn-sm btn-secondary" :disabled="respondingEfwId === e.id" @click="respondEfw(e, 'hold')">
                      Hold
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Reason Code Breakdown -->
      <div v-if="hasReasonCodes" class="card">
        <h3 class="section-title">Dispute Reason Breakdown</h3>
        <div v-for="(count, reason) in healthSnapshot.reason_code_breakdown" :key="String(reason)" class="flex-between mb-4">
          <span class="text-sm">{{ formatReasonCode(String(reason)) }}</span>
          <span class="badge badge-blue">{{ count }}</span>
        </div>
      </div>

      <!-- Module Recommendations (from Risk Audit) -->
      <div v-if="riskAudit?.moduleRecommendations?.length" class="card">
        <h3 class="section-title">Recommended Actions</h3>
        <div
          v-for="rec in riskAudit.moduleRecommendations"
          :key="rec.module"
          class="recommendation-item mb-4"
        >
          <div class="flex gap-2" style="align-items:flex-start">
            <span class="badge" :class="priorityBadge(rec.priority)">{{ rec.priority.toUpperCase() }}</span>
            <div>
              <div class="text-sm" style="font-weight:500">{{ rec.reason }}</div>
              <div class="text-sm text-muted">{{ rec.metric }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Links -->
      <div class="flex gap-2" style="flex-wrap:wrap">
        <router-link to="/defense/disputes" class="btn btn-secondary">Active Disputes ({{ activeDisputeCount }})</router-link>
        <router-link to="/defense" class="btn btn-secondary">Defense History</router-link>
        <button class="btn btn-secondary" @click="refreshHealth" :disabled="refreshing">
          {{ refreshing ? 'Refreshing...' : 'Refresh Data' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi, ssoSession } from '../composables/useApi';
import SectionHeader from '../components/SectionHeader.vue';
import { normalizeStripeHealthStatus } from '../utils/viewState';

const api = useApi();

const pageLoading = ref(true);
const refreshing = ref(false);
const stripeConnected = ref(false);
const healthSnapshot = ref<any>({});
const riskAudit = ref<any>(null);
const activeDisputeCount = ref(0);
const efws = ref<any[]>([]);
const respondingEfwId = ref<string | null>(null);

const unansweredEfwCount = computed(() => efws.value.filter((e) => !e.responded).length);
const riskLevel = computed(() => normalizeStripeHealthStatus(
  healthSnapshot.value.risk_level,
  ['safe', 'moderate', 'elevated', 'high', 'critical'],
));
const vampStatus = computed(() => normalizeStripeHealthStatus(
  healthSnapshot.value.vamp_status,
  ['safe', 'approaching', 'early_warning', 'standard_program'],
  riskLevel.value !== 'unknown',
));
const mcStatus = computed(() => normalizeStripeHealthStatus(
  healthSnapshot.value.mc_status,
  ['safe', 'warning', 'ecm_program'],
  riskLevel.value !== 'unknown',
));
const healthStatusIncomplete = computed(() => (
  riskLevel.value === 'unknown' || vampStatus.value === 'unknown' || mcStatus.value === 'unknown'
));

const hasReasonCodes = computed(() => {
  return healthSnapshot.value.reason_code_breakdown && Object.keys(healthSnapshot.value.reason_code_breakdown).length > 0;
});

const disputeRateClass = computed(() => {
  if (healthSnapshot.value.dispute_rate == null) return 'rate-unknown';
  const rate = healthSnapshot.value.dispute_rate;
  if (rate >= 0.009) return 'rate-critical';
  if (rate >= 0.0065) return 'rate-high';
  if (rate >= 0.005) return 'rate-elevated';
  if (rate >= 0.003) return 'rate-moderate';
  return 'rate-safe';
});

onMounted(async () => {
  await loadDashboardData();
});

async function loadDashboardData() {
  pageLoading.value = true;
  try {
    const config = await api.get<any>('/api/merchants/config');
    stripeConnected.value = config.stripeConnected || false;

    if (!stripeConnected.value) {
      pageLoading.value = false;
      return;
    }

    // Load health snapshot, risk audit, disputes, and EFWs in parallel
    const [health, audit, disputes, efwData] = await Promise.all([
      api.get<any>('/api/stripe/health').catch(() => ({ snapshot: null })),
      api.get<any>('/api/stripe/risk-audit').catch(() => null),
      api.get<any>(`/api/disputes/${ssoSession.locationId}`).catch(() => ({ disputes: [] })),
      api.get<any>(`/api/efws/${ssoSession.locationId}`).catch(() => ({ efws: [] })),
    ]);

    healthSnapshot.value = health.snapshot || {};
    riskAudit.value = audit;
    activeDisputeCount.value = disputes.disputes?.filter((d: any) => d.outcome === null || d.outcome === 'pending').length || 0;
    // Unanswered first, then newest
    efws.value = (efwData.efws || []).sort((a: any, b: any) => {
      if (!!a.responded !== !!b.responded) return a.responded ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  } finally {
    pageLoading.value = false;
  }
}

async function refreshHealth() {
  refreshing.value = true;
  try {
    await api.post('/api/stripe/risk-audit');
    await loadDashboardData();
  } catch (err) {
    console.error('Failed to refresh:', err);
  } finally {
    refreshing.value = false;
  }
}

async function respondEfw(efw: any, action: 'refund' | 'hold') {
  const message = action === 'refund'
    ? 'Refund this charge in Stripe? This usually prevents the fraud dispute and its fee. The issuer\'s fraud report still counts toward Visa\'s monitoring thresholds either way. This cannot be undone.'
    : 'Hold this charge (no refund)? If the issuer escalates it to a formal dispute, you\'ll fight it with a defense packet.';
  if (!window.confirm(message)) return;
  respondingEfwId.value = efw.id;
  try {
    await api.post(`/api/efws/${ssoSession.locationId}/${efw.id}/respond`, { action });
    await loadDashboardData();
  } catch {
    /* useApi already toasts the error */
  } finally {
    respondingEfwId.value = null;
  }
}

function formatDate(d: string): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFraudType(type: string): string {
  const map: Record<string, string> = {
    card_never_received: 'Card Never Received',
    fraudulent_card_application: 'Fraudulent Card Application',
    made_with_counterfeit_card: 'Counterfeit Card',
    made_with_lost_card: 'Lost Card',
    made_with_stolen_card: 'Stolen Card',
    misc: 'Miscellaneous',
    unauthorized_use_of_card: 'Unauthorized Use',
  };
  return map[type] || type || 'Unknown';
}

function formatVampStatus(status: string): string {
  const map: Record<string, string> = {
    safe: 'Safe',
    approaching: 'Approaching Warning',
    early_warning: 'Early Warning Program',
    standard_program: 'Standard Program',
  };
  return map[status] || status || 'Unknown';
}

function formatMcStatus(status: string): string {
  const map: Record<string, string> = {
    safe: 'Safe',
    warning: 'Warning',
    ecm_program: 'ECM Program',
  };
  return map[status] || status || 'Unknown';
}

function formatReasonCode(code: string): string {
  const map: Record<string, string> = {
    fraudulent: 'Fraudulent',
    product_not_received: 'Product Not Received',
    general: 'Not as Described',
    credit_not_processed: 'Credit Not Processed',
    unrecognized: 'Unrecognized Charge',
  };
  return map[code] || code;
}

function priorityBadge(priority: string): string {
  const map: Record<string, string> = {
    critical: 'badge-red',
    high: 'badge-red',
    medium: 'badge-yellow',
    low: 'badge-green',
  };
  return map[priority] || 'badge-gray';
}
</script>

<style scoped>
.section-title {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.risk-banner {
  padding: 12px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
}

.risk-banner-safe { background: #d1fae5; color: #065f46; }
.risk-banner-moderate { background: #fef3c7; color: #92400e; }
.risk-banner-elevated { background: #ffedd5; color: #9a3412; }
.risk-banner-high { background: #fee2e2; color: #991b1b; }
.risk-banner-critical { background: #fecaca; color: #7f1d1d; }
.risk-banner-unknown { background: #f1f5f9; color: #475569; }

.health-status-warning {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  color: #475569;
  font-size: 13px;
  padding: 10px 12px;
}

.rate-safe { color: #059669; }
.rate-moderate { color: #d97706; }
.rate-elevated { color: #ea580c; }
.rate-high { color: #dc2626; }
.rate-critical { color: #991b1b; }
.rate-unknown { color: #64748b; }

.vamp-status-safe { color: #059669; }
.vamp-status-approaching { color: #d97706; }
.vamp-status-early_warning { color: #ea580c; }
.vamp-status-standard_program { color: #dc2626; }
.vamp-status-unknown { color: #64748b; }

.mc-status-safe { color: #059669; }
.mc-status-warning { color: #d97706; }
.mc-status-ecm_program { color: #dc2626; }
.mc-status-unknown { color: #64748b; }

.recommendation-item {
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

.recommendation-item:last-child {
  border-bottom: none;
}
</style>
