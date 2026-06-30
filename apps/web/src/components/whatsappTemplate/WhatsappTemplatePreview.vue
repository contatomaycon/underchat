<script setup lang="ts">
import { computed } from 'vue';
import { WhatsappTemplateComponent } from '@core/schema/worker/whatsappOfficialTemplate';

const props = defineProps<{
  components: WhatsappTemplateComponent[];
}>();

const header = computed(() =>
  props.components.find((component) => component.type === 'HEADER')
);
const body = computed(() =>
  props.components.find((component) => component.type === 'BODY')
);
const footer = computed(() =>
  props.components.find((component) => component.type === 'FOOTER')
);
const buttons = computed(() => {
  const buttonComponent = props.components.find(
    (component) => component.type === 'BUTTONS'
  );
  return Array.isArray(buttonComponent?.buttons)
    ? (buttonComponent.buttons as Record<string, unknown>[])
    : [];
});

const headerLabel = computed(() => {
  if (!header.value) return null;
  const format = String(header.value.format ?? 'TEXT');
  if (format === 'IMAGE') return 'Imagem';
  if (format === 'VIDEO') return 'Vídeo';
  if (format === 'DOCUMENT') return 'Documento';
  if (format === 'LOCATION') return 'Localização';
  return String(header.value.text ?? '');
});
</script>

<template>
  <aside class="template-preview">
    <div class="template-preview__title">Prévia do modelo</div>
    <div class="template-preview__phone">
      <div class="template-preview__bubble">
        <div v-if="headerLabel" class="template-preview__header">
          {{ headerLabel }}
        </div>
        <div class="template-preview__body">
          {{ body?.text || 'Sua mensagem aparecerá aqui.' }}
        </div>
        <div v-if="footer?.text" class="template-preview__footer">
          {{ footer.text }}
        </div>
        <div class="template-preview__time">11:59</div>
        <div v-if="buttons.length" class="template-preview__buttons">
          <button
            v-for="(button, index) in buttons"
            :key="`${button.type}-${index}`"
            class="template-preview__button"
            type="button"
          >
            {{ button.text || button.type }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.template-preview {
  position: sticky;
  inset-block-start: 84px;
  align-self: start;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
}

.template-preview__title {
  padding: 16px;
  border-block-end: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
  font-weight: 700;
}

.template-preview__phone {
  min-block-size: 360px;
  padding: 18px;
  background-color: #f4efe7;
  background-image:
    radial-gradient(rgba(80, 72, 62, 0.06) 1px, transparent 1px),
    radial-gradient(rgba(80, 72, 62, 0.04) 1px, transparent 1px);
  background-position:
    0 0,
    9px 9px;
  background-size: 18px 18px;
}

.template-preview__bubble {
  inline-size: min(100%, 290px);
  overflow: hidden;
  border-radius: 8px;
  background: white;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}

.template-preview__header {
  min-block-size: 72px;
  display: grid;
  place-items: center;
  padding: 12px;
  background: #eef2f6;
  color: #475569;
  font-weight: 600;
}

.template-preview__body {
  padding: 12px 12px 4px;
  white-space: pre-wrap;
}

.template-preview__footer {
  padding: 0 12px 6px;
  color: #64748b;
  font-size: 0.8rem;
}

.template-preview__time {
  padding: 0 12px 8px;
  color: #64748b;
  font-size: 0.72rem;
  text-align: end;
}

.template-preview__buttons {
  border-block-start: 1px solid #e5e7eb;
}

.template-preview__button {
  inline-size: 100%;
  min-block-size: 42px;
  border: 0;
  border-block-end: 1px solid #e5e7eb;
  background: white;
  color: #0f8f78;
  cursor: default;
  font-weight: 700;
}

.template-preview__button:last-child {
  border-block-end: 0;
}
</style>
