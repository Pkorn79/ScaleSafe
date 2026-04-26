<template>
  <div class="ss-empty">
    <div class="ss-empty-icon-wrap">
      <component :is="icon" :size="32" :stroke-width="1.5" />
    </div>
    <div class="ss-empty-title">{{ title }}</div>
    <div v-if="body" class="ss-empty-body">{{ body }}</div>
    <div v-if="$slots.cta || ctaLabel" class="ss-empty-cta">
      <slot name="cta">
        <Button v-if="ctaLabel" :variant="ctaVariant" @click="$emit('cta-click')">{{ ctaLabel }}</Button>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import Button from './Button.vue';

withDefaults(defineProps<{
  icon: Component;
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaVariant?: 'primary' | 'funnel' | 'secondary' | 'tertiary';
}>(), {
  ctaVariant: 'primary',
});

defineEmits<{ (e: 'cta-click'): void }>();
</script>

<style>
.ss-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 24px;
  gap: 8px;
}
.ss-empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 9999px;
  background: var(--ss-primary-50);
  color: var(--ss-primary-600);
  margin-bottom: 8px;
}
.ss-empty-title {
  font-family: 'Manrope', 'Inter', sans-serif;
  font-size: 17px;
  font-weight: 700;
  color: var(--ss-navy-900);
  letter-spacing: -0.01em;
}
.ss-empty-body {
  font-size: 14px;
  color: var(--ss-navy-500);
  max-width: 360px;
  line-height: 1.55;
}
.ss-empty-cta { margin-top: 12px; }
</style>
