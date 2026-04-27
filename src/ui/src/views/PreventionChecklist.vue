<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Prevention Checklist</h1>
      <router-link to="/defense/dashboard" class="btn btn-secondary">Back to Dashboard</router-link>
    </div>

    <div v-if="loadError" class="error-msg">{{ loadError }}</div>
    <div v-if="pageLoading" class="loading">Loading prevention data...</div>

    <template v-if="!pageLoading && !loadError">
      <!-- Risk Audit Scores -->
      <div v-if="riskAudit" class="card">
        <h3 class="section-title">Risk Audit Profile</h3>
        <p class="text-sm text-muted mb-4">
          Overall Risk: <strong :class="'risk-level-' + (riskAudit.overallRiskLevel || 'safe')">{{ (riskAudit.overallRiskLevel || 'unknown').toUpperCase() }}</strong>
        </p>
        <div class="scores-grid">
          <div v-for="score in riskScores" :key="score.key" class="score-item">
            <div class="flex-between">
              <span class="text-sm" style="font-weight:500">{{ score.label }}</span>
              <span class="text-sm" style="font-weight:600">{{ score.value }}/100</span>
            </div>
            <div class="score-bar">
              <div class="score-fill" :style="{ width: score.value + '%', background: scoreColor(score.value) }"></div>
            </div>
            <p v-if="score.description" class="text-sm text-muted mt-2">{{ score.description }}</p>
          </div>
        </div>
      </div>

      <!-- Prevention Items -->
      <div v-if="preventionItems.length > 0" class="card">
        <h3 class="section-title">Prevention Coverage</h3>
        <div v-for="item in preventionItems" :key="item.id" class="prevention-item">
          <div class="flex gap-2" style="align-items:flex-start">
            <span class="prevention-icon" :class="item.completed ? 'icon-done' : 'icon-pending'">
              {{ item.completed ? '!' : '?' }}
            </span>
            <div style="flex:1">
              <div class="text-sm" style="font-weight:500">{{ item.title }}</div>
              <div class="text-sm text-muted">{{ item.description }}</div>
            </div>
            <span class="badge" :class="item.completed ? 'badge-green' : 'badge-yellow'">
              {{ item.completed ? 'Done' : 'Pending' }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="!riskAudit && preventionItems.length === 0" class="empty-state">
        <p>No prevention data available yet. Connect Stripe and run a risk audit to see your prevention checklist.</p>
        <router-link to="/settings/payments" class="btn btn-primary mt-4">Connect Stripe</router-link>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi, ssoSession } from '../composables/useApi';

const api = useApi();

const pageLoading = ref(true);
const loadError = ref<string | null>(null);
const riskAudit = ref<any>(null);
const preventionItems = ref<any[]>([]);

const riskScores = computed(() => {
  if (!riskAudit.value) return [];
  return [
    { key: 'disputeRate', label: 'Dispute Rate', value: riskAudit.value.scoreDisputeRate || 0, description: 'Based on your 30-day dispute-to-transaction ratio' },
    { key: 'evidenceCoverage', label: 'Evidence Coverage', value: riskAudit.value.scoreEvidenceCoverage || 0, description: 'How complete your evidence files are across transactions' },
    { key: 'refundPolicy', label: 'Refund Policy', value: riskAudit.value.scoreRefundPolicy || 0, description: 'Clarity and accessibility of your refund/cancellation policy' },
    { key: 'customerComm', label: 'Customer Communication', value: riskAudit.value.scoreCustomerComm || 0, description: 'Frequency and quality of customer communication records' },
    { key: 'billingClarity', label: 'Billing Clarity', value: riskAudit.value.scoreBillingClarity || 0, description: 'Statement descriptor clarity and billing transparency' },
  ];
});

onMounted(async () => {
  await loadPreventionData();
});

async function loadPreventionData() {
  pageLoading.value = true;
  loadError.value = null;
  try {
    const [audit, prevention] = await Promise.all([
      api.get<any>(`/api/stripe/risk-audit/${ssoSession.locationId}`).catch(() => null),
      api.get<any>(`/api/stripe/prevention/${ssoSession.locationId}`).catch(() => ({ items: [] })),
    ]);
    riskAudit.value = audit;
    preventionItems.value = prevention.items || [];
  } catch (err: any) {
    loadError.value = err.message || 'Failed to load prevention data';
  } finally {
    pageLoading.value = false;
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}
</script>

<style scoped>
.section-title {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.scores-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.score-item {
  padding-bottom: 12px;
  border-bottom: 1px solid #f3f4f6;
}

.score-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.prevention-item {
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
}

.prevention-item:last-child {
  border-bottom: none;
}

.prevention-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.icon-done {
  background: #d1fae5;
  color: #065f46;
}

.icon-pending {
  background: #fef3c7;
  color: #92400e;
}

.risk-level-safe { color: #059669; }
.risk-level-moderate { color: #d97706; }
.risk-level-elevated { color: #ea580c; }
.risk-level-high { color: #dc2626; }
.risk-level-critical { color: #991b1b; }
</style>
