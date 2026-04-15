<template>
  <div class="ss-profile-tabs-wrapper">
    <!-- Desktop / tablet: top tab row -->
    <nav class="ss-profile-tabs-desktop" role="tablist" aria-label="Client profile sections">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="modelValue === tab.key"
        :class="['ss-profile-tab', { 'ss-profile-tab-active': modelValue === tab.key }]"
        @click="select(tab.key)"
      >
        <component v-if="tab.icon" :is="tab.icon" :size="15" />
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <!-- Mobile: bottom nav -->
    <nav class="ss-profile-tabs-mobile" role="tablist" aria-label="Client profile sections">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="modelValue === tab.key"
        :class="['ss-profile-tab-mobile', { 'ss-profile-tab-mobile-active': modelValue === tab.key }]"
        @click="select(tab.key)"
      >
        <component v-if="tab.icon" :is="tab.icon" :size="18" />
        <span class="ss-profile-tab-mobile-label">{{ tab.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';

export interface TabDef {
  key: string;
  label: string;
  icon?: Component;
}

defineProps<{
  modelValue: string;
  tabs: TabDef[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

function select(key: string) {
  emit('update:modelValue', key);
}
</script>

<style>
.ss-profile-tabs-wrapper {
  /* Wrapper — desktop tabs are rendered inline, mobile nav is fixed */
}

/* ── Desktop tabs ───────────────────────────────────────────── */
.ss-profile-tabs-desktop {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 16px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.ss-profile-tabs-desktop::-webkit-scrollbar { display: none; }

.ss-profile-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
  transition: all 0.15s;
}

.ss-profile-tab:hover {
  color: #0f172a;
}

.ss-profile-tab-active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

/* ── Mobile bottom-nav ──────────────────────────────────────── */
.ss-profile-tabs-mobile {
  display: none;
}

@media (max-width: 768px) {
  .ss-profile-tabs-desktop {
    display: none;
  }

  .ss-profile-tabs-mobile {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #fff;
    border-top: 1px solid #e2e8f0;
    padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px));
    z-index: 90;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
  }

  .ss-profile-tab-mobile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 4px 2px;
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    transition: color 0.15s;
    min-height: 48px;
  }

  .ss-profile-tab-mobile-label {
    font-size: 10px;
    font-weight: 500;
    line-height: 1;
  }

  .ss-profile-tab-mobile-active {
    color: #3b82f6;
  }

  /* When bottom-nav is active, main content needs bottom padding so it isn't hidden */
  body.ss-profile-open main {
    padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)) !important;
  }
}
</style>
