<template>
  <div>
    <router-link to="/roadmap" class="back-link">Back to roadmap</router-link>

    <div v-if="!feature" class="card">
      <SectionHeader
        eyebrow="Roadmap"
        title="Feature not found"
        description="This roadmap item is not available."
      />
    </div>

    <template v-else>
      <SectionHeader
        :eyebrow="featureAreaLabels[feature.area]"
        :title="[feature.title, '']"
        :description="feature.summary"
      >
        <template #actions>
          <FeatureStatusPill :status="feature.status" />
        </template>
      </SectionHeader>

      <div class="preview-layout">
        <section class="card preview-main">
          <div class="card-title">What this does</div>
          <p class="preview-copy">{{ feature.userValue }}</p>

          <div class="preview-panel">
            <div class="preview-panel-header">
              <span>{{ feature.title }}</span>
              <FeatureStatusPill :status="feature.status" />
            </div>
            <div class="preview-placeholder">
              <div v-for="step in feature.workflow" :key="step" class="preview-step">
                <span class="step-dot"></span>
                <span>{{ step }}</span>
              </div>
            </div>
            <button class="btn btn-secondary" disabled>
              Preview only
            </button>
          </div>
        </section>

        <aside class="card">
          <div class="card-title">Status</div>
          <div class="detail-list">
            <div>
              <span>Area</span>
              <strong>{{ featureAreaLabels[feature.area] }}</strong>
            </div>
            <div>
              <span>Availability</span>
              <strong>{{ featureStatusLabels[feature.status] }}</strong>
            </div>
            <div v-if="feature.currentState">
              <span>Current state</span>
              <strong>{{ feature.currentState }}</strong>
            </div>
            <div v-if="feature.proofNeeded">
              <span>Proof needed</span>
              <strong>{{ feature.proofNeeded }}</strong>
            </div>
          </div>

          <div v-if="feature.dependencies?.length" class="mt-4">
            <div class="card-title">Needs</div>
            <div class="pill-wrap">
              <span v-for="dependency in feature.dependencies" :key="dependency" class="badge badge-gray">
                {{ dependency }}
              </span>
            </div>
          </div>

          <div v-if="feature.channels?.length" class="mt-4">
            <div class="card-title">Channels</div>
            <div class="pill-wrap">
              <span v-for="channel in feature.channels" :key="channel" class="badge badge-blue">
                {{ channel }}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SectionHeader from '../components/SectionHeader.vue';
import FeatureStatusPill from '../components/FeatureStatusPill.vue';
import {
  featureAreaLabels,
  featureStatusLabels,
  getPublicFeatureById,
} from '../lib/featureCatalog';

const route = useRoute();
const feature = computed(() => getPublicFeatureById(String(route.params.id || '')));
</script>

<style scoped>
.back-link {
  display: inline-flex;
  margin-bottom: 14px;
  color: var(--ss-primary-700);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.preview-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
}

.preview-main {
  min-height: 420px;
}

.preview-copy {
  color: var(--ss-navy-700);
  font-size: 15px;
  line-height: 1.65;
  margin: 0 0 18px;
}

.preview-panel {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--ss-navy-200);
  border-radius: 12px;
  background: var(--ss-cream-50);
}

.preview-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 700;
  color: var(--ss-navy-900);
}

.preview-placeholder {
  display: grid;
  gap: 10px;
}

.preview-step {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  color: var(--ss-navy-700);
  font-size: 14px;
  line-height: 1.5;
}

.step-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ss-primary-500);
  margin-top: 6px;
}

.detail-list {
  display: grid;
  gap: 12px;
}

.detail-list div {
  display: grid;
  gap: 3px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ss-navy-100);
}

.detail-list span {
  color: var(--ss-navy-500);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.detail-list strong {
  color: var(--ss-navy-800);
  font-size: 13px;
  line-height: 1.45;
}

.pill-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 900px) {
  .preview-layout {
    grid-template-columns: 1fr;
  }
}
</style>
