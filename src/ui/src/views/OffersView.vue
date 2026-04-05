<template>
  <div>
    <div class="flex-between mb-4">
      <h1 class="page-title">Offers</h1>
      <router-link to="/offers/new" class="btn btn-primary">New Offer</router-link>
    </div>

    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="loading" class="loading">Loading offers...</div>

    <div v-if="offers.length === 0 && !loading" class="empty-state">
      <p>No offers yet. Create your first offer to start enrolling clients.</p>
    </div>

    <div class="card" v-if="offers.length > 0">
      <table class="table">
        <thead>
          <tr>
            <th>Offer Name</th>
            <th>Price</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Link</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="offer in offers" :key="offer.id">
            <td>
              <strong>{{ offer.offer_name }}</strong>
              <div class="text-sm text-muted">{{ offer.delivery_method || 'Not set' }}</div>
            </td>
            <td>${{ offer.price || 0 }}</td>
            <td>
              <span class="badge" :class="offer.payment_type === 'one_time' ? 'badge-blue' : 'badge-green'">
                {{ offer.payment_type === 'one_time' ? 'Pay in Full' : `${offer.num_payments}x $${offer.installment_amount}` }}
              </span>
            </td>
            <td>
              <span class="badge" :class="offer.active ? 'badge-green' : 'badge-gray'">
                {{ offer.active ? 'Active' : 'Inactive' }}
              </span>
              <span v-if="offer.checkout_mode === 'quick_checkout'" class="badge badge-blue" style="margin-left:4px">Quick</span>
            </td>
            <td>
              <button class="btn btn-sm btn-secondary" @click="copyLink(offer.id)">Copy Link</button>
            </td>
            <td style="white-space:nowrap">
              <router-link :to="`/offers/${offer.id}/edit`" class="btn btn-sm btn-secondary">Edit</router-link>
              <button class="btn btn-sm btn-secondary" style="margin-left:4px" @click="cloneOffer(offer)">Clone</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="copied" style="position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;padding:10px 20px;border-radius:6px;font-size:14px;">
      Enrollment link copied!
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
const offers = ref<any[]>([]);
const copied = ref(false);

onMounted(async () => {
  try {
    offers.value = await api.get<any[]>('/api/offers');
  } catch {}
});

async function copyLink(offerId: string) {
  try {
    const { link } = await api.get<{ link: string }>(`/api/offers/${offerId}/enrollment-link`);
    await navigator.clipboard.writeText(link);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {}
}

async function cloneOffer(offer: any) {
  if (!confirm(`Clone '${offer.offer_name}'? This will create an inactive copy you can edit.`)) return;
  try {
    const result = await api.post<any>(`/api/offers/${offer.id}/clone`, {});
    if (result?.offer?.id) {
      routerNav.push(`/offers/${result.offer.id}/edit`);
    }
  } catch {}
}
</script>
