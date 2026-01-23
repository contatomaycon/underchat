<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

const { t } = useI18n();

const activeTab = ref<'editor' | 'preview'>('editor');
const htmlContent = ref(props.modelValue || '');

watch(
  () => props.modelValue,
  (newValue) => {
    if (htmlContent.value !== newValue) {
      htmlContent.value = newValue || '';
    }
  }
);

const updateContent = (value: string) => {
  htmlContent.value = value;
  emit('update:modelValue', value);
};

const getRenderableHtml = (html: string): string => {
  if (!html) return '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1].trim();
  }

  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    let cleaned = html
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<body[^>]*>/gi, '')
      .replace(/<\/body>/gi, '')
      .trim();

    if (cleaned) {
      return cleaned;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const body = doc.querySelector('body');
      if (body && body.innerHTML.trim()) {
        return body.innerHTML.trim();
      }
    } catch (error) {}
  }

  return html;
};

const previewHtml = computed(() => getRenderableHtml(htmlContent.value));
</script>

<template>
  <div class="release-html-editor">
    <VTabs v-model="activeTab" class="mb-4">
      <VTab value="editor">
        <VIcon icon="tabler-code" class="me-2" />
        {{ $t('html_editor') || 'Editor HTML' }}
      </VTab>
      <VTab value="preview">
        <VIcon icon="tabler-eye" class="me-2" />
        {{ $t('preview') || 'Preview' }}
      </VTab>
    </VTabs>

    <VWindow v-model="activeTab">
      <VWindowItem value="editor">
        <VTextarea
          :model-value="htmlContent"
          :placeholder="
            placeholder || $t('message') || 'Digite ou cole o HTML aqui...'
          "
          rows="15"
          class="html-textarea"
          @update:model-value="updateContent"
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{
            $t('html_editor_hint') ||
            'Cole ou digite HTML bruto. Use a aba Preview para visualizar.'
          }}
        </div>
      </VWindowItem>

      <VWindowItem value="preview">
        <VCard variant="outlined" class="preview-card">
          <VCardText>
            <div
              v-if="previewHtml"
              v-html="previewHtml"
              class="html-preview-content"
            ></div>
            <div v-else class="text-body-2 text-medium-emphasis">
              {{
                $t('no_preview_available') || 'Nenhum conteúdo para visualizar'
              }}
            </div>
          </VCardText>
        </VCard>
      </VWindowItem>
    </VWindow>
  </div>
</template>

<style lang="scss" scoped>
.release-html-editor {
  .html-textarea {
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
  }

  .preview-card {
    min-height: 300px;
  }

  .html-preview-content {
    max-width: 100%;
    overflow-x: auto;
  }

  .html-preview-content :deep(img) {
    max-width: 100%;
    height: auto;
  }

  .html-preview-content :deep(table) {
    max-width: 100%;
    overflow-x: auto;
  }

  .html-preview-content :deep(*) {
    max-width: 100%;
  }
}
</style>
