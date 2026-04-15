<template>
  <Teleport to="body">
    <div v-if="open" class="ss-modal-overlay" @click.self="close">
      <div class="ss-modal-card" :style="maxWidth ? { maxWidth } : undefined" role="dialog" aria-modal="true">
        <div v-if="title || $slots.header" class="ss-modal-header">
          <slot name="header">
            <h3 class="ss-modal-title">{{ title }}</h3>
          </slot>
          <button type="button" class="ss-modal-close" aria-label="Close" @click="close">×</button>
        </div>
        <div class="ss-modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="ss-modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title?: string;
  maxWidth?: string;
  closeOnEsc?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();

function close() {
  emit('update:open', false);
  emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open && props.closeOnEsc !== false) {
    close();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

// Lock body scroll while open
watch(() => props.open, (val) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = val ? 'hidden' : '';
});
</script>

<style>
/* Global (not scoped) so content inside the default slot picks up base form styles */
.ss-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  animation: ss-modal-fade-in 0.15s ease-out;
}

.ss-modal-card {
  background: #fff;
  border-radius: 12px;
  max-width: 480px;
  width: 100%;
  max-height: calc(100vh - 32px);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ss-modal-slide-in 0.18s ease-out;
}

.ss-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid #f1f5f9;
  gap: 12px;
}

.ss-modal-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

.ss-modal-close {
  background: none;
  border: none;
  font-size: 26px;
  line-height: 1;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
  transition: all 0.15s;
}

.ss-modal-close:hover {
  color: #0f172a;
  background: #f1f5f9;
}

.ss-modal-body {
  padding: 18px 20px;
  overflow-y: auto;
  flex: 1 1 auto;
}

.ss-modal-footer {
  padding: 14px 20px 18px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

@keyframes ss-modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes ss-modal-slide-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 640px) {
  .ss-modal-overlay { padding: 0; align-items: flex-end; }
  .ss-modal-card {
    max-width: 100%;
    max-height: 90vh;
    border-radius: 16px 16px 0 0;
  }
}
</style>
