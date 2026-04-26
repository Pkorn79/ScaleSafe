<template>
  <div :class="['ss-form-layout', { 'ss-form-layout-with-aside': hasAside }]">
    <div class="ss-form-layout-main">
      <slot />
    </div>
    <aside v-if="hasAside" class="ss-form-layout-aside">
      <slot name="aside" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';

const slots = useSlots();
const hasAside = computed(() => Boolean(slots.aside));
</script>

<style>
/*
 * Two-column form layout: form left, ancillary content (preview, help, recent activity) right.
 * Falls back to single column on viewports below the breakpoint.
 *
 * Pairs with <StickySaveBar /> on long forms.
 */
.ss-form-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.ss-form-layout-main { min-width: 0; }

.ss-form-layout-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 16px;
}

/* Two-column from lg breakpoint up. Keep main flexible (1fr) and aside fixed-ish. */
@media (min-width: 1024px) {
  .ss-form-layout-with-aside {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
@media (min-width: 1280px) {
  .ss-form-layout-with-aside {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}
</style>
