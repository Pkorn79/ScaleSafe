<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :class="[
      'ss-btn',
      `ss-btn-${variant}`,
      `ss-btn-${size}`,
      { 'ss-btn-block': block },
    ]"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="ss-btn-spinner" aria-hidden="true" />
    <component v-else-if="iconLeft" :is="iconLeft" :size="iconSize" class="ss-btn-icon" />
    <span class="ss-btn-label"><slot /></span>
    <component v-if="iconRight && !loading" :is="iconRight" :size="iconSize" class="ss-btn-icon" />
  </button>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';

type Variant = 'primary' | 'funnel' | 'secondary' | 'tertiary' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const props = withDefaults(defineProps<{
  variant?: Variant;
  size?: Size;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
  block?: boolean;
  iconLeft?: Component;
  iconRight?: Component;
}>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
  block: false,
});

defineEmits<{ (e: 'click', event: MouseEvent): void }>();

const iconSize = computed(() => (props.size === 'sm' ? 14 : props.size === 'lg' ? 18 : 16));
</script>

<style>
.ss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 9999px;          /* pill */
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 600;
  letter-spacing: -0.005em;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.05s, box-shadow 0.15s;
  white-space: nowrap;
  user-select: none;
}
.ss-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ss-btn:active:not(:disabled) { transform: translateY(0.5px); }
.ss-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3);
}
.ss-btn-block { width: 100%; }

/* Sizes */
.ss-btn-sm { padding: 6px 14px;  font-size: 13px; min-height: 32px; }
.ss-btn-md { padding: 9px 20px;  font-size: 14px; min-height: 40px; }
.ss-btn-lg { padding: 12px 26px; font-size: 15px; min-height: 48px; }

/* Variant - primary (emerald fill, in-app engagement).
   Uses emerald-700 so white text clears WCAG AA contrast (4.5:1); 500/600 fail. */
.ss-btn-primary {
  background: var(--ss-primary-700);
  color: #fff;
  border-color: var(--ss-primary-700);
}
.ss-btn-primary:hover:not(:disabled) {
  background: var(--ss-primary-800);
  border-color: var(--ss-primary-800);
}

/* Variant - funnel (orange fill, top-of-funnel CTAs only) */
.ss-btn-funnel {
  background: var(--ss-funnel-500);
  color: #fff;
  border-color: var(--ss-funnel-500);
}
.ss-btn-funnel:hover:not(:disabled) {
  background: var(--ss-funnel-600);
  border-color: var(--ss-funnel-600);
}

/* Variant - secondary (emerald outline) */
.ss-btn-secondary {
  background: transparent;
  color: var(--ss-primary-700);
  border-color: var(--ss-primary-300);
}
.ss-btn-secondary:hover:not(:disabled) {
  background: var(--ss-primary-50);
  border-color: var(--ss-primary-500);
  color: var(--ss-primary-800);
}

/* Variant - tertiary (text-only, no border) */
.ss-btn-tertiary {
  background: transparent;
  color: var(--ss-primary-700);
  border-color: transparent;
}
.ss-btn-tertiary:hover:not(:disabled) {
  background: var(--ss-primary-50);
  color: var(--ss-primary-800);
}

/* Variant - destructive (red ghost - Cancel program, Archive, Delete) */
.ss-btn-destructive {
  background: transparent;
  color: #b91c1c;
  border-color: #fecaca;
}
.ss-btn-destructive:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #ef4444;
  color: #991b1b;
}
.ss-btn-destructive:focus-visible {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25);
}

.ss-btn-icon { flex-shrink: 0; }
.ss-btn-label { display: inline-flex; align-items: center; }

.ss-btn-spinner {
  width: 14px; height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: ss-btn-spin 0.7s linear infinite;
}
@keyframes ss-btn-spin { to { transform: rotate(360deg); } }
</style>
