<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Defense History</h1>
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
        <div class="card-value" style="color:#10b981">${{ summary.totalValueSaved.toLocaleString() }}</div>
      </div>
    </div>

    <!-- Defense Packets Table -->
    <div class="card" v-if="packets.length > 0">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Contact</th>
            <th>Reason Code</th>
            <th>Amount</th>
            <th>Deadline</th>
            <th>Status</th>
            <th>Outcome</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in packets" :key="p.id">
            <td class="text-sm">{{ formatDate(p.created_at) }}</td>
            <td class="text-sm">{{ p.contact_id?.slice(0, 10) }}...</td>
            <td><span class="badge badge-blue">{{ p.reason_code }}</span></td>
            <td>${{ p.dispute_amount }}</td>
            <td class="text-sm">{{ formatDate(p.deadline) }}</td>
            <td>
              <span class="badge" :class="statusBadge(p.status)">{{ p.status }}</span>
            </td>
            <td>
              <span v-if="p.outcome" class="badge" :class="p.outcome.outcome === 'won' ? 'badge-green' : 'badge-red'">
                {{ p.outcome.outcome }}
              </span>
              <span v-else-if="p.status === 'complete'" class="text-sm text-muted">Pending</span>
            </td>
            <td>
              <router-link :to="`/defense/${p.id}`" class="btn btn-sm btn-secondary">View</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="packets.length === 0 && !loading" class="empty-state">
      <p>No defense packets yet.</p>
    </div>

    <!-- Compile Modal -->
    <div v-if="showCompile" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:100">
      <div class="card" style="width:500px;max-height:90vh;overflow-y:auto">
        <h2 style="margin-bottom:16px">Compile Defense Packet</h2>
        <div v-if="compileError" class="error-msg">{{ compileError }}</div>

        <div class="form-group">
          <label class="form-label">Contact ID *</label>
          <input class="form-input" v-model="compileForm.contactId" required />
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
        <div class="grid grid-2">
          <div class="form-group">
            <label class="form-label">Dispute Date *</label>
            <input class="form-input" type="date" v-model="compileForm.disputeDate" />
          </div>
          <div class="form-group">
            <label class="form-label">Deadline *</label>
            <input class="form-input" type="date" v-model="compileForm.deadline" />
          </div>
        </div>

        <div class="flex gap-2 mt-4">
          <button class="btn btn-primary" @click="compile" :disabled="compiling">
            {{ compiling ? 'Submitting...' : 'Compile Defense' }}
          </button>
          <button class="btn btn-secondary" @click="showCompile = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';

const api = useApi();
const routerNav = useRouter();
const { loading, error } = api;

const packets = ref<any[]>([]);
const summary = ref<any>(null);
const showCompile = ref(false);
const compiling = ref(false);
const compileError = ref<string | null>(null);

const compileForm = ref({
  contactId: '',
  reasonCode: '',
  disputeAmount: 0,
  disputeDate: '',
  deadline: '',
  caseNumber: '',
});

function formatDate(d: string): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-yellow', processing: 'badge-blue',
    complete: 'badge-green', failed: 'badge-red',
  };
  return map[status] || 'badge-gray';
}

async function compile() {
  compiling.value = true;
  compileError.value = null;
  try {
    const result = await api.post<any>('/api/defense/compile', compileForm.value);
    showCompile.value = false;
    routerNav.push(`/defense/${result.defenseId}`);
  } catch (e: any) {
    compileError.value = e.message;
  } finally {
    compiling.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await api.get<any>('/api/dashboard/defense-history');
    packets.value = data.packets || [];
    summary.value = data.summary || {};
  } catch {}
});
</script>
