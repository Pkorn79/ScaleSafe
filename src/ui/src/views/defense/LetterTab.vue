<template>
  <div>
    <div class="flex-between mb-4">
      <div class="card-title" style="margin-bottom:0">Defense Letter</div>
      <div class="flex gap-2" v-if="!isLocked">
        <button class="btn btn-sm btn-secondary" @click="$emit('regenerate')" :disabled="regenerating">
          {{ regenerating ? 'Regenerating...' : 'Regenerate' }}
        </button>
        <button class="btn btn-sm btn-primary" @click="save" :disabled="saving || !isDirty">
          {{ saving ? 'Saving...' : 'Save Edit' }}
        </button>
      </div>
      <span v-else class="badge badge-blue">Locked — submitted</span>
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

      <div class="flex-between mt-2" style="color:#94a3b8;font-size:12px">
        <span>{{ editableText.length.toLocaleString() }} characters · Version {{ versionNumber }}</span>
        <span v-if="tokenInfo">{{ tokenInfo }}</span>
      </div>
    </div>

    <div v-if="error" class="error-msg mt-2">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';

const props = defineProps<{
  letterText: string;
  status: string;
  lifecycleStatus: string;
  versionNumber: number;
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

watch(() => props.letterText, (val) => {
  editableText.value = val || '';
  isDirty.value = false;
});

const tokenInfo = computed(() => {
  if (!props.inputTokens && !props.outputTokens) return '';
  return `Tokens: ${props.inputTokens || 0} in / ${props.outputTokens || 0} out`;
});

function save() {
  emit('save', editableText.value);
  isDirty.value = false;
}

function renderMarkdown(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4 style="font-size:13px;font-weight:600;margin:10px 0 4px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:14px 0 6px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">$1</h3>')
    .replace(/\n/g, '<br>');
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
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
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
