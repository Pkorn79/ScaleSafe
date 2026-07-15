<template>
  <Pill :tone="tone" :icon="icon">
    {{ featureStatusLabels[status] }}
  </Pill>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Compass, ListTodo } from 'lucide-vue-next';
import Pill from './Pill.vue';
import { featureStatusLabels, type FeatureStatus } from '../lib/featureCatalog';

const props = defineProps<{
  status: FeatureStatus;
}>();

const tone = computed(() => {
  if (props.status === 'planned') return 'teal';
  return 'amber';
});

const icon = computed(() => {
  if (props.status === 'planned') return ListTodo;
  return Compass;
});
</script>
