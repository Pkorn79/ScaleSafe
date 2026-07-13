<template>
  <div>
    <div class="card-title mb-4">Evidence Exhibits ({{ reportedCount }})</div>

    <div v-if="legacySnapshot" class="legacy-note">
      This packet contains {{ reportedCount }} {{ reportedCount === 1 ? 'exhibit' : 'exhibits' }} in its PDF.
      It was compiled before ScaleSafe began preserving the itemized exhibit list for this screen, so use
      <strong>Download PDF</strong> above to review the frozen exhibits submitted with this packet.
    </div>

    <div v-else-if="exhibits.length === 0" class="text-sm text-muted">
      No evidence exhibits available for this client. Evidence is collected automatically as clients enroll, make payments, and engage with the program.
    </div>

    <div v-for="ex in exhibits" :key="ex.letter" class="exhibit-card">
      <div class="exhibit-header">
        <span class="exhibit-letter">{{ ex.letter }}</span>
        <div>
          <div class="exhibit-name">{{ ex.name }}</div>
          <div class="exhibit-meta">
            <span class="badge" :class="categoryBadge(ex.category)">{{ formatCategory(ex.category) }}</span>
            <span v-if="ex.occurredAt" class="text-muted" style="margin-left:8px">{{ formatDate(ex.occurredAt) }}</span>
          </div>
        </div>
      </div>
      <div class="exhibit-summary">{{ ex.summary }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  exhibits: Array<{
    letter: string;
    name: string;
    category: string;
    source: string;
    ref: string;
    occurredAt: string | null;
    summary: string;
  }>;
  reportedCount?: number;
  legacySnapshot?: boolean;
}>(), {
  reportedCount: 0,
  legacySnapshot: false,
});

function formatDate(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCategory(cat: string): string {
  return (cat || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function categoryBadge(cat: string): string {
  if (cat === 'consent') return 'badge-green';
  if (cat === 'service_delivery') return 'badge-blue';
  if (cat === 'communication') return 'badge-yellow';
  if (cat === 'payments') return 'badge-green';
  if (cat === 'termination') return 'badge-red';
  return 'badge-gray';
}
</script>

<style scoped>
.exhibit-card {
  padding: 12px 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 10px;
}

.exhibit-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 8px;
}

.exhibit-letter {
  background: var(--ss-primary-500);
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.exhibit-name {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.exhibit-meta {
  display: flex;
  align-items: center;
  margin-top: 2px;
  font-size: 12px;
}

.exhibit-summary {
  font-size: 13px;
  color: #374151;
  line-height: 1.5;
}

.legacy-note {
  padding: 12px 14px;
  color: #374151;
  background: #f9fafb;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}
</style>
