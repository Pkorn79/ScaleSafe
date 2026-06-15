<template>
  <Teleport to="body">
    <div class="ss-toast-region" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="ss-toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="ss-toast"
          :class="`ss-toast--${t.type}`"
          :role="t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'"
        >
          <component :is="iconFor(t.type)" :size="18" class="ss-toast__icon" aria-hidden="true" />
          <div class="ss-toast__content">
            <p v-if="t.title" class="ss-toast__title">{{ t.title }}</p>
            <p class="ss-toast__message">{{ t.message }}</p>
          </div>
          <button type="button" class="ss-toast__close" aria-label="Dismiss notification" @click="dismiss(t.id)">
            <X :size="15" aria-hidden="true" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-vue-next';
import { useToast, type ToastType } from '../composables/useToast';

const { toasts, dismiss } = useToast();

function iconFor(type: ToastType) {
  switch (type) {
    case 'success': return CheckCircle2;
    case 'error': return AlertCircle;
    case 'warning': return AlertTriangle;
    default: return Info;
  }
}
</script>

<style>
/* Sits above the modal layer (modal z-index is 1000). */
.ss-toast-region {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 360px;
  max-width: calc(100vw - 32px);
  pointer-events: none; /* let clicks through the empty region; toasts re-enable below */
}

.ss-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--ss-navy-200);
  border-left: 3px solid var(--ss-navy-300);
  border-radius: 12px;
  padding: 12px 12px 12px 14px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}

.ss-toast__icon { flex-shrink: 0; margin-top: 1px; }
.ss-toast__content { flex: 1 1 auto; min-width: 0; }

.ss-toast__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ss-navy-900);
  margin: 0 0 2px;
}

.ss-toast__message {
  font-size: 13px;
  line-height: 1.4;
  color: var(--ss-navy-700);
  margin: 0;
  overflow-wrap: anywhere;
}

.ss-toast__close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--ss-navy-400);
  cursor: pointer;
  padding: 2px;
  border-radius: 6px;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}
.ss-toast__close:hover { color: var(--ss-navy-800); background: var(--ss-navy-100); }
.ss-toast__close:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3); }

/* Per-type accent: left border + icon color. Uses the same brand semantics as
   badges (emerald success, red error, amber warning, teal info). */
.ss-toast--success { border-left-color: var(--ss-primary-500); }
.ss-toast--success .ss-toast__icon { color: var(--ss-primary-600); }

.ss-toast--error { border-left-color: #dc2626; }
.ss-toast--error .ss-toast__icon { color: #dc2626; }

.ss-toast--warning { border-left-color: #d97706; }
.ss-toast--warning .ss-toast__icon { color: #d97706; }

.ss-toast--info { border-left-color: var(--ss-teal-500); }
.ss-toast--info .ss-toast__icon { color: var(--ss-teal-600); }

/* Enter/leave + list-shift animation */
.ss-toast-enter-active { transition: transform 0.2s ease-out, opacity 0.2s ease-out; }
.ss-toast-leave-active { transition: transform 0.18s ease-in, opacity 0.18s ease-in; position: absolute; right: 0; width: 100%; }
.ss-toast-enter-from { transform: translateX(16px); opacity: 0; }
.ss-toast-leave-to { transform: translateX(16px); opacity: 0; }
.ss-toast-move { transition: transform 0.2s ease; }

@media (max-width: 640px) {
  .ss-toast-region { top: 8px; right: 8px; left: 8px; width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .ss-toast-enter-active,
  .ss-toast-leave-active,
  .ss-toast-move { transition: opacity 0.15s linear; }
  .ss-toast-enter-from,
  .ss-toast-leave-to { transform: none; }
}
</style>
