<template>
  <div :class="['ss-stat', `ss-stat-${accent}`]">
    <div class="ss-stat-label">{{ label }}</div>
    <div class="ss-stat-value">{{ value }}</div>
    <div v-if="delta || description" class="ss-stat-meta">
      <span v-if="delta !== undefined && delta !== null" :class="['ss-stat-delta', `ss-stat-delta-${trend}`]">
        <component v-if="trend === 'up'"   :is="ArrowUp"   :size="12" />
        <component v-if="trend === 'down'" :is="ArrowDown" :size="12" />
        <component v-if="trend === 'flat'" :is="Minus"     :size="12" />
        {{ delta }}
      </span>
      <span v-if="description" class="ss-stat-description">{{ description }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp, ArrowDown, Minus } from 'lucide-vue-next';

type Accent = 'emerald' | 'navy' | 'teal' | 'orange' | 'plain';
type Trend = 'up' | 'down' | 'flat';

withDefaults(defineProps<{
  label: string;
  value: string | number;
  delta?: string | number;
  trend?: Trend;
  description?: string;
  accent?: Accent;
}>(), {
  trend: 'flat',
  accent: 'plain',
});
</script>

<style>
.ss-stat {
  background: #fff;
  border-radius: 16px;
  padding: 18px 20px;
  border: 1px solid var(--ss-navy-200);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 110px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ss-stat:hover { border-color: var(--ss-navy-300); }

.ss-stat-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ss-navy-500);
}

.ss-stat-value {
  font-family: 'Manrope', 'Inter', sans-serif;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ss-navy-900);
  letter-spacing: -0.02em;
  margin-top: 6px;
}

.ss-stat-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
}

.ss-stat-delta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 600;
}
.ss-stat-delta-up   { color: var(--ss-primary-700); }
.ss-stat-delta-down { color: #b91c1c; }
.ss-stat-delta-flat { color: var(--ss-navy-500); }

.ss-stat-description {
  color: var(--ss-navy-500);
}

/* Accent - left border stripe matching the brand role of this stat */
.ss-stat-emerald { border-left: 3px solid var(--ss-primary-500); }
.ss-stat-navy    { border-left: 3px solid var(--ss-navy-700); }
.ss-stat-teal    { border-left: 3px solid var(--ss-teal-500); }
.ss-stat-orange  { border-left: 3px solid var(--ss-funnel-500); }
.ss-stat-plain   { /* no accent stripe */ }
</style>
