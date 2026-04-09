<template>
  <div>
    <h1 class="page-title">Payment Management</h1>

    <div class="card" style="max-width:600px">
      <div class="flex gap-2 mb-4">
        <input class="form-input" v-model="searchQuery" placeholder="Search by name or contact ID..."
          @keyup.enter="search" style="flex:1" />
        <button class="btn btn-primary" @click="search" :disabled="loading">Search</button>
      </div>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Searching...</div>

    <div v-if="customers.length === 0 && searched && !loading" class="empty-state">
      <p>No customers with payment history found.</p>
    </div>

    <div v-for="c in customers" :key="c.contactId" class="card" style="max-width:600px">
      <div class="flex-between">
        <div>
          <strong>{{ c.name || c.email || c.contactId.slice(0, 12) + '...' }}</strong>
          <div v-if="c.email && c.name" class="text-sm text-muted">{{ c.email }}</div>
          <div v-if="c.programName" class="text-sm text-muted">{{ c.programName }}</div>
          <div class="text-sm text-muted">
            ${{ c.totalCharged.toFixed(2) }} charged
            <span v-if="c.totalRefunded > 0"> &middot; ${{ c.totalRefunded.toFixed(2) }} refunded</span>
            <span v-if="c.lastPaymentDate"> &middot; Last: {{ formatDate(c.lastPaymentDate) }}</span>
          </div>
        </div>
        <router-link :to="`/payments/${c.contactId}`" class="btn btn-sm btn-primary">
          Manage Payments
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '../composables/useApi';

const api = useApi();
const { loading, error } = api;
const searchQuery = ref('');
const customers = ref<any[]>([]);
const searched = ref(false);

onMounted(() => search());

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function search() {
  try {
    searched.value = true;
    const params = searchQuery.value ? `?search=${encodeURIComponent(searchQuery.value)}` : '';
    const result = await api.get<any>(`/api/payments/manage/customers${params}`);
    customers.value = result?.customers || [];
  } catch {}
}
</script>
