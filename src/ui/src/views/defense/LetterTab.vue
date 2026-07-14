<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Defense Letter</div>
      <div class="flex gap-2" v-if="!isLocked">
        <button class="btn btn-sm btn-secondary" @click="$emit('regenerate')" :disabled="regenerating || isCompiling">
          {{ regenerating || isCompiling ? 'Regenerating...' : 'Regenerate' }}
        </button>
        <button class="btn btn-sm btn-primary" @click="save" :disabled="saving || !isDirty">
          {{ saving ? 'Saving...' : 'Save Edit' }}
        </button>
      </div>
      <span v-else class="badge badge-blue">Locked - submitted</span>
    </div>

    <div v-if="!letterText && status === 'processing'" class="loading">AI is generating the defense letter... this may take 1-2 minutes.</div>

    <div v-if="letterText">
      <textarea
        v-if="!isLocked"
        v-model="editableText"
        class="letter-editor"
        @input="isDirty = true"
        spellcheck="true"
      ></textarea>
      <div v-else class="letter-readonly" v-html="renderMarkdown(letterText)"></div>

      <div class="flex-between mt-2" style="color: var(--ss-navy-500); font-size: 12px">
        <span>{{ editableText.length.toLocaleString() }} characters - Version {{ versionNumber }}</span>
      </div>
    </div>

    <div v-if="error" class="error-msg mt-2">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const props = defineProps<{
  letterText: string;
  status: string;
  lifecycleStatus: string;
  versionNumber: number;
  // inputTokens / outputTokens kept on the prop signature for API compatibility,
  // but no longer surfaced to the merchant - moved to support-only diagnostic view.
  inputTokens?: number;
  outputTokens?: number;
  regenerating: boolean;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'regenerate'): void;
  (e: 'save', text: string): void;
}>();

const editableText = ref(props.letterText || '');
const isDirty = ref(false);
const isLocked = computed(() => ['submitted', 'won', 'lost', 'withdrawn'].includes(props.lifecycleStatus));
const isCompiling = computed(() => ['pending', 'processing'].includes(props.status));

watch(() => props.letterText, (val) => {
  editableText.value = val || '';
  isDirty.value = false;
});

function save() {
  emit('save', editableText.value);
  isDirty.value = false;
}

function renderMarkdown(text: string): string {
  const rawHtml = marked.parse(text || '', {
    async: false,
    breaks: true,
    gfm: true,
  });

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote'],
    ALLOWED_ATTR: [],
  });
}
</script>

<style scoped>
.letter-editor {
  width: 100%;
  min-height: 400px;
  padding: 16px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  line-height: 1.6;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  resize: vertical;
  outline: none;
}

.letter-editor:focus {
  border-color: var(--ss-primary-500);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}

.letter-readonly {
  padding: 16px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  max-height: 500px;
  overflow-y: auto;
}
</style>
