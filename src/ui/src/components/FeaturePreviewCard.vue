<template>
  <router-link :to="`/roadmap/${feature.id}`" class="feature-card">
    <div class="feature-card-top">
      <div>
        <div class="feature-area">{{ featureAreaLabels[feature.area] }}</div>
        <h3>{{ feature.title }}</h3>
      </div>
      <FeatureStatusPill :status="feature.status" />
    </div>
    <p>{{ feature.summary }}</p>
    <div v-if="feature.currentState" class="feature-current">{{ feature.currentState }}</div>
  </router-link>
</template>

<script setup lang="ts">
import FeatureStatusPill from './FeatureStatusPill.vue';
import { featureAreaLabels, type FeatureItem } from '../lib/featureCatalog';

defineProps<{
  feature: FeatureItem;
}>();
</script>

<style scoped>
.feature-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 172px;
  padding: 18px;
  border: 1px solid var(--ss-navy-200);
  border-radius: 12px;
  background: #fff;
  color: inherit;
  text-decoration: none;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}

.feature-card:hover {
  border-color: var(--ss-primary-300);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

.feature-card-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.feature-area {
  color: var(--ss-primary-700);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h3 {
  margin: 4px 0 0;
  color: var(--ss-navy-900);
  font-size: 17px;
  line-height: 1.25;
}

p {
  color: var(--ss-navy-600);
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

.feature-current {
  margin-top: auto;
  color: var(--ss-navy-500);
  font-size: 12px;
  line-height: 1.45;
  border-top: 1px solid var(--ss-navy-100);
  padding-top: 10px;
}
</style>
