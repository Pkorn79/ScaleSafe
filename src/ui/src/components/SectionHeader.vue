<template>
  <header class="ss-section-header">
    <div class="ss-section-header-text">
      <div v-if="eyebrow" class="ss-section-eyebrow">{{ eyebrow }}</div>
      <h2 class="ss-section-title">
        <template v-if="Array.isArray(title)">
          <span class="ss-section-title-navy">{{ title[0] }}</span>
          <template v-if="title[1]">
            <span> </span>
            <span class="ss-section-title-emerald">{{ title[1] }}</span>
          </template>
        </template>
        <template v-else>
          <span class="ss-section-title-navy">{{ title }}</span>
        </template>
      </h2>
      <p v-if="description" class="ss-section-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="ss-section-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  /** Small-caps emerald label sitting above the title. e.g. "Defense" */
  eyebrow?: string;
  /** Title — string for solid color, or [navy, emerald] tuple for two-tone heading. */
  title: string | [string, string];
  description?: string;
}>();
</script>

<style>
.ss-section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.ss-section-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ss-section-eyebrow {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ss-primary-600);
  margin-bottom: 2px;
}

.ss-section-title {
  font-family: 'Manrope', 'Inter', sans-serif;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0;
}
.ss-section-title-navy    { color: var(--ss-navy-900); }
.ss-section-title-emerald { color: var(--ss-primary-600); }

.ss-section-description {
  margin: 4px 0 0 0;
  font-size: 14px;
  color: var(--ss-navy-500);
  max-width: 56ch;
  line-height: 1.55;
}

.ss-section-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .ss-section-header { flex-direction: column; align-items: flex-start; }
  .ss-section-title  { font-size: 22px; }
}
</style>
