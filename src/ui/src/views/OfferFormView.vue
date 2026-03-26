<template>
  <div>
    <h1 class="page-title">{{ isEdit ? 'Edit Offer' : 'New Offer' }}</h1>

    <div v-if="error" class="error-msg">{{ error }}</div>

    <form @submit.prevent="save" class="card" style="max-width: 700px">
      <div class="form-group">
        <label class="form-label">Program Name *</label>
        <input class="form-input" v-model="form.offerName" required />
      </div>

      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" v-model="form.programDescription"></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Delivery Method</label>
        <select class="form-select" v-model="form.deliveryMethod">
          <option value="">Select...</option>
          <option value="Live Virtual (Zoom/Meet)">Live Virtual</option>
          <option value="In-Person">In-Person</option>
          <option value="Self-Paced / On-Demand">Self-Paced</option>
          <option value="Hybrid">Hybrid</option>
          <option value="Digital Download">Digital Download</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div class="grid grid-2">
        <div class="form-group">
          <label class="form-label">Total Price *</label>
          <input class="form-input" type="number" step="0.01" v-model.number="form.price" required />
        </div>
        <div class="form-group">
          <label class="form-label">Payment Type</label>
          <select class="form-select" v-model="form.paymentType">
            <option value="one_time">Pay in Full</option>
            <option value="installments">Installments</option>
          </select>
        </div>
      </div>

      <div v-if="form.paymentType === 'installments'" class="grid grid-3">
        <div class="form-group">
          <label class="form-label">Installment Amount</label>
          <input class="form-input" type="number" step="0.01" v-model.number="form.installmentAmount" />
        </div>
        <div class="form-group">
          <label class="form-label">Frequency</label>
          <select class="form-select" v-model="form.installmentFrequency">
            <option value="weekly">Weekly</option>
            <option value="bi_weekly">Bi-Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label"># of Payments</label>
          <input class="form-input" type="number" v-model.number="form.numPayments" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Refund Policy</label>
        <textarea class="form-textarea" v-model="form.refundWindowText" placeholder="e.g., 30-day money-back guarantee..."></textarea>
      </div>

      <!-- Milestones -->
      <h3 class="mt-4 mb-4">Milestones</h3>
      <div v-for="(m, i) in form.milestones" :key="i" class="grid grid-3 mb-4" style="align-items:end">
        <div class="form-group">
          <label class="form-label">Milestone {{ i + 1 }} Name</label>
          <input class="form-input" v-model="m.name" :placeholder="`Milestone ${i + 1}`" />
        </div>
        <div class="form-group">
          <label class="form-label">Delivers</label>
          <input class="form-input" v-model="m.delivers" />
        </div>
        <div class="form-group">
          <label class="form-label">Client Does</label>
          <input class="form-input" v-model="m.clientDoes" />
        </div>
      </div>

      <!-- T&C Clauses -->
      <h3 class="mt-4 mb-4">Terms & Conditions Clauses</h3>
      <div v-for="(c, i) in form.clauses" :key="i" class="mb-4">
        <div class="form-group">
          <label class="form-label">Clause {{ i + 1 }} Title</label>
          <input class="form-input" v-model="c.title" :placeholder="`Clause ${i + 1}`" />
        </div>
        <div class="form-group">
          <label class="form-label">Clause {{ i + 1 }} Text</label>
          <textarea class="form-textarea" v-model="c.text" style="min-height:50px"></textarea>
        </div>
      </div>

      <div class="flex gap-2 mt-4">
        <button type="submit" class="btn btn-primary" :disabled="loading">
          {{ loading ? 'Saving...' : (isEdit ? 'Update Offer' : 'Create Offer') }}
        </button>
        <router-link to="/offers" class="btn btn-secondary">Cancel</router-link>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '../composables/useApi';

const route = useRoute();
const routerNav = useRouter();
const api = useApi();
const { loading, error } = api;

const isEdit = computed(() => !!route.params.id);

const form = ref({
  offerName: '',
  programDescription: '',
  deliveryMethod: '',
  price: 0,
  paymentType: 'one_time' as 'one_time' | 'installments',
  installmentAmount: 0,
  installmentFrequency: 'monthly',
  numPayments: 0,
  refundWindowText: '',
  milestones: Array.from({ length: 8 }, () => ({ name: '', delivers: '', clientDoes: '' })),
  clauses: Array.from({ length: 5 }, () => ({ title: '', text: '' })),
});

onMounted(async () => {
  if (isEdit.value) {
    try {
      const offer = await api.get<any>(`/api/offers/${route.params.id}`);
      form.value.offerName = offer.offer_name || '';
      form.value.programDescription = offer.program_description || '';
      form.value.deliveryMethod = offer.delivery_method || '';
      form.value.price = offer.price || 0;
      form.value.paymentType = offer.payment_type || 'one_time';
      form.value.installmentAmount = offer.installment_amount || 0;
      form.value.installmentFrequency = offer.installment_frequency || 'monthly';
      form.value.numPayments = offer.num_payments || 0;
      form.value.refundWindowText = offer.refund_window_text || '';

      for (let i = 0; i < 8; i++) {
        form.value.milestones[i].name = offer[`m${i + 1}_name`] || '';
        form.value.milestones[i].delivers = offer[`m${i + 1}_delivers`] || '';
        form.value.milestones[i].clientDoes = offer[`m${i + 1}_client_does`] || '';
      }

      for (let i = 0; i < 5; i++) {
        form.value.clauses[i].title = offer[`clause_slot_${i + 1}_title`] || '';
        form.value.clauses[i].text = offer[`clause_slot_${i + 1}_text`] || '';
      }
    } catch {}
  }
});

async function save() {
  const payload = {
    ...form.value,
    milestones: form.value.milestones.filter(m => m.name),
    clauses: form.value.clauses.filter(c => c.title),
  };

  try {
    if (isEdit.value) {
      await api.put(`/api/offers/${route.params.id}`, payload);
    } else {
      await api.post('/api/offers', payload);
    }
    routerNav.push('/offers');
  } catch {}
}
</script>
