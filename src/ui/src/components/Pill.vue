<template>
  <span :class="['ss-pill', `ss-pill-${tone}`, `ss-pill-${size}`]">
    <component v-if="icon" :is="icon" :size="iconSize" class="ss-pill-icon" />
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';

type Tone =
  | 'emerald'    // success / on-track / connected
  | 'navy'       // structural / neutral-strong
  | 'teal'       // accent / secondary status
  | 'orange'     // funnel / attention
  | 'red'        // error / destructive
  | 'amber'      // warning / pending
  | 'gray';      // muted / inactive

type Size = 'sm' | 'md';

const props = withDefaults(defineProps<{
  tone?: Tone;
  size?: Size;
  icon?: Component;
}>(), {
  tone: 'gray',
  size: 'sm',
});

const iconSize = computed(() => (props.size === 'sm' ? 11 : 13));
</script>

<style>
.ss-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 9999px;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.ss-pill-sm { font-size: 11px; padding: 2px 8px; line-height: 1.4; }
.ss-pill-md { font-size: 12px; padding: 3px 10px; line-height: 1.5; }
.ss-pill-icon { flex-shrink: 0; }

.ss-pill-emerald { background: var(--ss-primary-50);  color: var(--ss-primary-800); }
.ss-pill-navy    { background: var(--ss-navy-100);    color: var(--ss-navy-800); }
.ss-pill-teal    { background: var(--ss-teal-50);     color: var(--ss-teal-700); }
.ss-pill-orange  { background: var(--ss-funnel-50);   color: var(--ss-funnel-700); }
.ss-pill-red     { background: #fee2e2;               color: #991b1b; }
.ss-pill-amber   { background: #fef3c7;               color: #92400e; }
.ss-pill-gray    { background: var(--ss-navy-100);    color: var(--ss-navy-600); }
</style>
