<template>
  <div class="ss-skeleton" :style="style" aria-hidden="true"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  width?: string;
  height?: string;
  radius?: string;
  circle?: boolean;
}>(), {
  width: '100%',
  height: '1em',
  radius: '8px',
});

const style = computed(() => ({
  width: props.width,
  height: props.height,
  borderRadius: props.circle ? '50%' : props.radius,
}));
</script>

<style>
/* Shimmering placeholder. Decorative only (aria-hidden); the surrounding region
   should carry an aria-busy/loading cue for assistive tech. */
.ss-skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--ss-navy-100) 25%,
    var(--ss-navy-200) 37%,
    var(--ss-navy-100) 63%
  );
  background-size: 400% 100%;
  animation: ss-skeleton-shimmer 1.4s ease infinite;
}

@keyframes ss-skeleton-shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}

@media (prefers-reduced-motion: reduce) {
  .ss-skeleton {
    animation: none;
    background: var(--ss-navy-100);
  }
}
</style>
