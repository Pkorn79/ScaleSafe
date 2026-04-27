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
      <div class="risk-banner mb-4" :class="'risk-banner-' + (healthSnapshot.risk_level || 'safe')">
        <span class="text-sm">Account Risk Level:</span>
        <strong style="margin-left:8px;font-size:16px">{{ (healthSnapshot.risk_level || 'unknown').toUpperCase() }}</strong>
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
      <div class="card mb-4">
        <h3 class="section-title">Network Monitoring Status</h3>
        <div class="grid grid-2">
          <div>
            <span class="text-sm"><strong>Visa VAMP:</strong></span>
            <span class="text-sm" :class="'vamp-status-' + (healthSnapshot.vamp_status || 'safe')" style="margin-left:8px">
              {{ formatVampStatus(healthSnapshot.vamp_status) }}
            </span>
          </div>
          <div>
            <span class="text-sm"><strong>Mastercard:</strong></span>
            <span class="text-sm" :class="'mc-status-' + (healthSnapshot.mc_status || 'safe')" style="margin-left:8px">
              {{ formatMcStatus(healthSnapshot.mc_status) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Reason Code Breakdown -->
      <div v-if="hasReasonCodes" class="card mb-4">
        <h3 class="section-title">Dispute Reason Breakdown</h3>
        <div v-for="(count, reason) in healthSnapshot.reason_code_breakdown" :key="String(reason)" class="flex-between mb-4">
          <span class="text-sm">{{ formatReasonCode(String(reason)) }}</span>
          <span class="badge badge-blue">{{ count }}</span>
        </div>
      </div>

      <!-- Module Recommendations (from Risk Audit) -->
      <div v-if="riskAudit?.moduleRecommendations?.length" class="card mb-4">
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

const api = useApi();

const pageLoading = ref(true);
const refreshing = ref(false);
const stripeConnected = ref(false);
const healthSnapshot = ref<any>({});
const riskAudit = ref<any>(null);
const activeDisputeCount = ref(0);

const hasReasonCodes = computed(() => {
  return healthSnapshot.value.reason_code_breakdown && Object.keys(healthSnapshot.value.reason_code_breakdown).length > 0;
});

const disputeRateClass = computed(() => {
  const rate = healthSnapshot.value.dispute_rate || 0;
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

    // Load health snapshot, risk audit, and disputes in parallel
    const [health, audit, disputes] = await Promise.all([
      api.get<any>(`/api/stripe/health/${ssoSession.locationId}`).catch(() => ({ snapshot: null })),
      api.get<any>(`/api/stripe/risk-audit/${ssoSession.locationId}`).catch(() => null),
      api.get<any>(`/api/disputes/${ssoSession.locationId}`).catch(() => ({ disputes: [] })),
    ]);

    healthSnapshot.value = health.snapshot || {};
    riskAudit.value = audit;
    activeDisputeCount.value = disputes.disputes?.filter((d: any) => d.outcome === null || d.outcome === 'pending').length || 0;
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  } finally {
    pageLoading.value = false;
  }
}

async function refreshHealth() {
  refreshing.value = true;
  try {
    await api.post(`/api/stripe/risk-audit/${ssoSession.locationId}`);
    await loadDashboardData();
  } catch (err) {
    console.error('Failed to refresh:', err);
  } finally {
    refreshing.value = false;
  }
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

.rate-safe { color: #059669; }
.rate-moderate { color: #d97706; }
.rate-elevated { color: #ea580c; }
.rate-high { color: #dc2626; }
.rate-critical { color: #991b1b; }

.vamp-status-safe { color: #059669; }
.vamp-status-approaching { color: #d97706; }
.vamp-status-early_warning { color: #ea580c; }
.vamp-status-standard_program { color: #dc2626; }

.mc-status-safe { color: #059669; }
.mc-status-warning { color: #d97706; }
.mc-status-ecm_program { color: #dc2626; }

.recommendation-item {
  padding: 8px 0;
  border-bottom: 1px solid #f3f4f6;
}

.recommendation-item:last-child {
  border-bottom: none;
}
</style>
