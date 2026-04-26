<template>
  <nav :class="['ss-tabs', `ss-tabs-${variant}`]" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.key"
      :class="['ss-tab', { 'ss-tab-active': modelValue === tab.key }]"
      @click="select(tab.key)"
    >
      <component v-if="tab.icon" :is="tab.icon" :size="iconSize" />
      <span class="ss-tab-label">{{ tab.label }}</span>
      <span v-if="tab.count !== undefined" class="ss-tab-count">{{ tab.count }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';

export interface TabDef {
  key: string;
  label: string;
  icon?: Component;
  count?: number;
}

type Variant = 'underline' | 'pill' | 'segmented';

const props = withDefaults(defineProps<{
  modelValue: string;
  tabs: TabDef[];
  variant?: Variant;
  ariaLabel?: string;
}>(), {
  variant: 'underline',
  ariaLabel: 'Tabs',
});

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const iconSize = computed(() => (props.variant === 'pill' ? 14 : 15));

function select(key: string) {
  emit('update:modelValue', key);
}
</script>

<style>
.ss-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'Inter', system-ui, sans-serif;
}
.ss-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s;
  font-size: 14px;
  color: var(--ss-navy-500);
}
.ss-tab:hover { color: var(--ss-navy-900); }
.ss-tab-label { line-height: 1; }
.ss-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 9999px;
  background: var(--ss-navy-100);
  color: var(--ss-navy-700);
  font-size: 11px;
  font-weight: 600;
}
.ss-tab-active .ss-tab-count {
  background: var(--ss-teal-100);
  color: var(--ss-teal-700);
}

/* ── underline variant (default — matches ProfileTabs aesthetic, with teal active) ── */
.ss-tabs-underline {
  border-bottom: 1px solid var(--ss-navy-200);
  gap: 0;
}
.ss-tabs-underline .ss-tab {
  padding: 10px 16px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.ss-tabs-underline .ss-tab-active {
  color: var(--ss-teal-700);
  border-bottom-color: var(--ss-teal-500);
}

/* ── pill variant (segmented buttons, each fully rounded) ── */
.ss-tabs-pill { gap: 6px; }
.ss-tabs-pill .ss-tab {
  padding: 7px 14px;
  border-radius: 9999px;
  border: 1px solid transparent;
}
.ss-tabs-pill .ss-tab:hover {
  background: var(--ss-navy-100);
}
.ss-tabs-pill .ss-tab-active {
  background: var(--ss-primary-50);
  color: var(--ss-primary-800);
  border-color: var(--ss-primary-200);
}

/* ── segmented variant (single rounded container, tabs share borders) ── */
.ss-tabs-segmented {
  background: var(--ss-navy-100);
  padding: 4px;
  border-radius: 10px;
  gap: 0;
  display: inline-flex;
}
.ss-tabs-segmented .ss-tab {
  padding: 6px 14px;
  border-radius: 7px;
}
.ss-tabs-segmented .ss-tab-active {
  background: #fff;
  color: var(--ss-navy-900);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
</style>
