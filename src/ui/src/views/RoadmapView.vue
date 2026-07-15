<template>
  <div>
    <SectionHeader
      eyebrow="Roadmap"
      :title="['What we are', 'considering next.']"
      description="Future improvements under active planning or research. Available ScaleSafe features live on their working pages, not in this roadmap."
    />

    <div class="roadmap-summary grid grid-2 mb-4">
      <div v-for="item in summary" :key="item.status" class="card metric-card">
        <div class="card-title">{{ item.label }}</div>
        <div class="card-value">{{ item.count }}</div>
      </div>
    </div>

    <div class="roadmap-filters mb-4">
      <button
        v-for="filter in filters"
        :key="filter.key"
        class="tab-btn"
        :class="{ active: activeFilter === filter.key }"
        @click="activeFilter = filter.key"
      >
        {{ filter.label }}
      </button>
    </div>

    <section v-for="group in visibleGroups" :key="group.area" class="roadmap-group">
      <div class="group-header">
        <h2>{{ featureAreaLabels[group.area] }}</h2>
        <span class="text-sm text-muted">{{ group.items.length }} item{{ group.items.length === 1 ? '' : 's' }}</span>
      </div>
      <div class="feature-grid">
        <FeaturePreviewCard v-for="feature in group.items" :key="feature.id" :feature="feature" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import SectionHeader from '../components/SectionHeader.vue';
import FeaturePreviewCard from '../components/FeaturePreviewCard.vue';
import {
  featureAreaLabels,
  featureStatusLabels,
  publicFeatureCatalog,
  type FeatureArea,
  type FeatureStatus,
} from '../lib/featureCatalog';

type FilterKey = 'all' | FeatureStatus;

const activeFilter = ref<FilterKey>('all');

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'planned', label: featureStatusLabels.planned },
  { key: 'researching', label: featureStatusLabels.researching },
];

const summary = computed(() => filters
  .filter((filter) => filter.key !== 'all')
  .map((filter) => ({
    status: filter.key,
    label: filter.label,
    count: publicFeatureCatalog.filter((feature) => feature.status === filter.key).length,
  })));

const visibleFeatures = computed(() => {
  if (activeFilter.value === 'all') return publicFeatureCatalog;
  return publicFeatureCatalog.filter((feature) => feature.status === activeFilter.value);
});

const visibleGroups = computed(() => {
  const areas = Object.keys(featureAreaLabels) as FeatureArea[];
  return areas
    .map((area) => ({
      area,
      items: visibleFeatures.value.filter((feature) => feature.area === area),
    }))
    .filter((group) => group.items.length > 0);
});
</script>

<style scoped>
.metric-card {
  margin-bottom: 0;
}

.roadmap-filters {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--ss-navy-200);
  border-radius: 10px;
}

.tab-btn {
  border: 0;
  background: transparent;
  color: var(--ss-navy-600);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--ss-primary-50);
  color: var(--ss-primary-800);
}

.roadmap-group {
  margin-top: 22px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.group-header h2 {
  color: var(--ss-navy-900);
  font-size: 18px;
  margin: 0;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
</style>
