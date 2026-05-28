<template>
  <div class="feature-setting-stub">
    <div class="feature-setting-main">
      <div class="feature-setting-title-row">
        <strong>{{ feature.title }}</strong>
        <FeatureStatusPill :status="feature.status" />
      </div>
      <p>{{ feature.summary }}</p>
      <div v-if="feature.currentState || feature.proofNeeded" class="feature-setting-note">
        {{ feature.currentState || feature.proofNeeded }}
      </div>
    </div>

    <div class="feature-setting-control">
      <label class="stub-toggle" :title="controlTitle">
        <input type="checkbox" disabled />
        <span class="stub-toggle-track">
          <span class="stub-toggle-thumb"></span>
        </span>
      </label>
      <router-link :to="`/roadmap/${feature.id}`" class="btn btn-sm btn-secondary">
        Preview
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import FeatureStatusPill from './FeatureStatusPill.vue';
import type { FeatureItem } from '../lib/featureCatalog';

const props = defineProps<{
  feature: FeatureItem;
}>();

const controlTitle = computed(() => {
  if (props.feature.status === 'coming_soon') return 'This setting is not active yet.';
  if (props.feature.status === 'needs_setup') return 'This setting needs setup before it is active.';
  return 'This beta setting is shown for planning and validation.';
});
</script>

<style scoped>
.feature-setting-stub {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--ss-navy-200);
  border-radius: 10px;
  background: #fff;
}

.feature-setting-main {
  min-width: 0;
}

.feature-setting-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.feature-setting-title-row strong {
  color: var(--ss-navy-900);
  font-size: 14px;
}

p {
  color: var(--ss-navy-600);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.feature-setting-note {
  color: var(--ss-navy-500);
  font-size: 12px;
  line-height: 1.45;
  margin-top: 7px;
}

.feature-setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stub-toggle {
  cursor: not-allowed;
  display: inline-flex;
}

.stub-toggle input {
  display: none;
}

.stub-toggle-track {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--ss-navy-200);
  border: 1px solid var(--ss-navy-300);
}

.stub-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 4px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
}

@media (max-width: 640px) {
  .feature-setting-stub {
    grid-template-columns: 1fr;
  }

  .feature-setting-control {
    justify-content: space-between;
  }
}
</style>
