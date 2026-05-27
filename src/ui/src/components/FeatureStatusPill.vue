<template>
  <Pill :tone="tone" :icon="icon">
    {{ featureStatusLabels[status] }}
  </Pill>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2, Clock3, Wrench, Lock, FlaskConical } from 'lucide-vue-next';
import Pill from './Pill.vue';
import { featureStatusLabels, type FeatureStatus } from '../lib/featureCatalog';

const props = defineProps<{
  status: FeatureStatus;
}>();

const tone = computed(() => {
  if (props.status === 'live') return 'emerald';
  if (props.status === 'beta') return 'teal';
  if (props.status === 'needs_setup') return 'amber';
  if (props.status === 'coming_soon') return 'red';
  return 'gray';
});

const icon = computed(() => {
  if (props.status === 'live') return CheckCircle2;
  if (props.status === 'beta') return FlaskConical;
  if (props.status === 'needs_setup') return Wrench;
  if (props.status === 'coming_soon') return Clock3;
  return Lock;
});
</script>
