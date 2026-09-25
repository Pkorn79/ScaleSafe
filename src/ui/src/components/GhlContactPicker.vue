<template>
  <div class="contact-picker">
    <div v-if="modelValue" class="selected-contact">
      <div class="contact-details">
        <strong>{{ modelValue.name || 'Unnamed contact' }}</strong>
        <span>{{ modelValue.email || 'No email' }}</span>
        <span>{{ modelValue.phone || 'No phone' }}</span>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" aria-label="Change contact" title="Change contact" :disabled="disabled" @click="clearSelection">
        <X :size="16" />
      </button>
    </div>
    <template v-else>
      <label for="offer-contact-search" class="form-label">Search HighLevel contacts</label>
      <div class="search-input">
        <Search :size="16" aria-hidden="true" />
        <input id="offer-contact-search" v-model="query" class="form-input" type="search" placeholder="Name, email, or phone" autocomplete="off" maxlength="75" :disabled="disabled" />
      </div>
      <div class="contact-results" :aria-busy="searching">
        <p v-if="searching" role="status" class="text-sm text-muted">Searching...</p>
        <p v-else-if="searchError" role="alert" class="error-msg">{{ searchError }}</p>
        <p v-else-if="searched && !contacts.length" role="status" class="text-sm text-muted">No matching contacts.</p>
        <ul v-else-if="contacts.length" aria-label="Matching contacts">
          <li v-for="contact in contacts" :key="contact.id">
            <button type="button" class="contact-result" :disabled="disabled" @click="selectContact(contact)">
              <strong>{{ contact.name || 'Unnamed contact' }}</strong>
              <span>{{ contact.email || 'No email' }}</span>
              <span>{{ contact.phone || 'No phone' }}</span>
            </button>
          </li>
        </ul>
      </div>
      <div v-if="searched && !searching && !searchError && (page > 1 || hasMore)" class="contact-pagination">
        <button type="button" class="btn btn-sm btn-secondary" aria-label="Previous contacts" title="Previous contacts" :disabled="page === 1 || disabled" @click="search(page - 1)"><ChevronLeft :size="16" /></button>
        <span class="text-sm">Page {{ page }}</span>
        <button type="button" class="btn btn-sm btn-secondary" aria-label="Next contacts" title="Next contacts" :disabled="!hasMore || disabled" @click="search(page + 1)"><ChevronRight :size="16" /></button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { Search, X, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { useApi } from '../composables/useApi';
import type { GhlContactOption } from '../lib/ghlContacts';

defineProps<{ modelValue: GhlContactOption | null; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', contact: GhlContactOption | null): void }>();
const api = useApi();
const query = ref('');
const contacts = ref<GhlContactOption[]>([]);
const searching = ref(false);
const searched = ref(false);
const searchError = ref('');
const page = ref(1);
const hasMore = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let request = 0;

watch(query, () => {
  clearTimeout(timer);
  request++;
  contacts.value = [];
  searched.value = false;
  searchError.value = '';
  page.value = 1;
  hasMore.value = false;
  searching.value = query.value.trim().length >= 2;
  if (searching.value) timer = setTimeout(() => search(1), 350);
});

async function search(nextPage: number) {
  const current = ++request;
  searching.value = true;
  searchError.value = '';
  try {
    const result = await api.get<{ contacts: GhlContactOption[]; page: number; hasMore: boolean }>(
      `/api/enrollment/contacts/search?q=${encodeURIComponent(query.value.trim())}&page=${nextPage}`,
    );
    if (current !== request) return;
    contacts.value = result.contacts;
    page.value = result.page;
    hasMore.value = result.hasMore;
    searched.value = true;
  } catch (err: any) {
    if (current === request) {
      contacts.value = [];
      searchError.value = err?.message || 'Unable to search HighLevel contacts.';
    }
  } finally {
    if (current === request) searching.value = false;
  }
}

function selectContact(contact: GhlContactOption) {
  request++;
  clearTimeout(timer);
  emit('update:modelValue', contact);
}

function clearSelection() {
  query.value = '';
  contacts.value = [];
  searched.value = false;
  emit('update:modelValue', null);
}

onBeforeUnmount(() => { request++; clearTimeout(timer); });
</script>

<style scoped>
.contact-picker { margin: 16px 0; min-width: 0; }
.search-input { position: relative; }
.search-input > svg { position: absolute; left: 12px; top: 13px; color: #64748b; }
.search-input input { padding-left: 36px; }
.contact-results { min-height: 32px; max-height: 240px; overflow-y: auto; }
.contact-results ul { padding: 0; margin: 8px 0 0; list-style: none; }
.contact-result { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 10px; background: transparent; border: 0; border-bottom: 1px solid #e2e8f0; text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.contact-result:hover, .contact-result:focus-visible { background: #f0fdf4; }
.contact-result span, .contact-details span { font-size: 13px; color: #475569; }
.contact-details { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.selected-contact { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 12px 0; }
.selected-contact button { flex-shrink: 0; }
.contact-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 8px; }
</style>
