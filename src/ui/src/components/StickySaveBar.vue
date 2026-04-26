<template>
  <Teleport to="body">
    <transition name="ss-sticky-save-fade">
      <div v-if="visible" class="ss-sticky-save" role="region" aria-label="Save bar">
        <div class="ss-sticky-save-inner">
          <div class="ss-sticky-save-status">
            <span v-if="dirty" class="ss-sticky-save-dot" aria-hidden="true" />
            <span class="ss-sticky-save-status-text">{{ statusLabel }}</span>
          </div>
          <div class="ss-sticky-save-actions">
            <slot name="actions">
              <Button v-if="cancelLabel" variant="tertiary" :disabled="loading" @click="$emit('cancel')">{{ cancelLabel }}</Button>
              <Button variant="primary" :loading="loading" :disabled="!dirty || loading" @click="$emit('save')">
                {{ saveLabel }}
              </Button>
            </slot>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from './Button.vue';

const props = withDefaults(defineProps<{
  /** Show the bar. Typically bound to "form has been mounted and scroll is past the form top". */
  visible?: boolean;
  /** Whether the form has unsaved changes — controls the dot indicator and Save button enabled-state. */
  dirty?: boolean;
  /** Save action in flight. */
  loading?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  /** Override status text. Defaults: dirty → "Unsaved changes" / clean → "All changes saved". */
  statusText?: string;
}>(), {
  visible: true,
  dirty: false,
  loading: false,
  saveLabel: 'Save changes',
  cancelLabel: '',
  statusText: '',
});

defineEmits<{
  (e: 'save'): void;
  (e: 'cancel'): void;
}>();

const statusLabel = computed(() => {
  if (props.statusText) return props.statusText;
  return props.dirty ? 'Unsaved changes' : 'All changes saved';
});
</script>

<style>
.ss-sticky-save {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.96);
  color: #fff;
  z-index: 80;
  border-top: 1px solid var(--ss-navy-700);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(8px);
}
.ss-sticky-save-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ss-sticky-save-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ss-navy-200);
}
.ss-sticky-save-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ss-funnel-500);
  box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.6);
  animation: ss-sticky-save-pulse 1.6s ease-out infinite;
}
@keyframes ss-sticky-save-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.6); }
  70%  { box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
  100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
}
.ss-sticky-save-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ss-sticky-save-fade-enter-active,
.ss-sticky-save-fade-leave-active { transition: transform 0.18s ease, opacity 0.18s ease; }
.ss-sticky-save-fade-enter-from,
.ss-sticky-save-fade-leave-to { opacity: 0; transform: translateY(8px); }

@media (max-width: 640px) {
  .ss-sticky-save-inner { padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); }
  .ss-sticky-save-status-text { display: none; }
}
</style>
