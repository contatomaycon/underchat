<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import WhatsappTemplateVariableSamples from './WhatsappTemplateVariableSamples.vue';
import type {
  HeaderFormat,
  MediaAttachmentPreview,
  ParameterFormat,
  SelectOption,
  TemplateDraft,
} from './types';

const props = defineProps<{
  bodyTextError: string;
  bodyVariables: string[];
  footerTextError: string;
  headerFormatOptions: SelectOption<HeaderFormat>[];
  headerMediaError: string;
  headerTextError: string;
  headerVariables: string[];
  mediaAttachment: MediaAttachmentPreview | null;
  parameterFormatOptions: SelectOption<ParameterFormat>[];
  uploading: boolean;
}>();

const emit = defineEmits<{
  handleMediaFile: [value: File | File[] | null];
  insertBodyMarkup: [value: string];
  insertBodyVariable: [];
  insertHeaderVariable: [];
  removeMediaFile: [];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
const isDraggingFile = shallowRef(false);
const headerFormatMenu = shallowRef(false);
const headerFormatSelectRef = shallowRef<HTMLElement | null>(null);
const mediaInputRef = shallowRef<HTMLInputElement | null>(null);

const mediaHeaderFormats = ['IMAGE', 'VIDEO', 'DOCUMENT'];
const nonTextHeaderFormats = [...mediaHeaderFormats, 'LOCATION'];
const mediaInputAccept = computed(() => {
  if (draft.value.header_format === 'IMAGE') return 'image/*';
  if (draft.value.header_format === 'VIDEO') return 'video/*';
  if (draft.value.header_format === 'DOCUMENT') {
    return '.pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  }

  return undefined;
});
const mediaAttachmentIcon = computed(() => {
  if (props.mediaAttachment?.format === 'VIDEO') return 'tabler-player-play';
  if (props.mediaAttachment?.format === 'DOCUMENT') return 'tabler-file-text';

  return 'tabler-photo';
});
const selectedHeaderFormatOption = computed(
  () =>
    props.headerFormatOptions.find(
      (option) => option.value === draft.value.header_format
    ) ?? props.headerFormatOptions[0]
);
const isTextHeaderDisabled = computed(() =>
  nonTextHeaderFormats.includes(draft.value.header_format)
);
const textHeaderDisabledTooltip = computed(() =>
  mediaHeaderFormats.includes(draft.value.header_format)
    ? t('whatsapp_template_header_text_remove_media_tooltip')
    : ''
);
const markupSample = () => t('whatsapp_template_markup_sample');
const wrapMarkup = (prefix: string, suffix = prefix) =>
  `${prefix}${markupSample()}${suffix}`;
const parameterTypeTooltip = () =>
  t('whatsapp_template_parameter_type_tooltip', {
    named: '{{order_id}}',
    numeric: '{{1}}',
  });

const updateMediaFile = (value: File | File[] | null) => {
  emit('handleMediaFile', value);
};

const updateHeaderFormat = (value: HeaderFormat) => {
  headerFormatMenu.value = false;
  draft.value.header_format = value;
};

const toggleHeaderFormatMenu = () => {
  headerFormatMenu.value = !headerFormatMenu.value;
};

const closeHeaderFormatMenuOnOutsideClick = (event: MouseEvent) => {
  const target = event.target;

  if (target instanceof Node && headerFormatSelectRef.value?.contains(target)) {
    return;
  }

  headerFormatMenu.value = false;
};

const openMediaPicker = () => {
  if (props.uploading) return;
  mediaInputRef.value?.click();
};

const handleMediaInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  if (file) updateMediaFile(file);
  input.value = '';
};

const handleDrop = (event: DragEvent) => {
  isDraggingFile.value = false;
  const file = event.dataTransfer?.files?.[0] ?? null;

  if (file) updateMediaFile(file);
};

onMounted(() => {
  document.addEventListener('mousedown', closeHeaderFormatMenuOnOutsideClick);
});

onBeforeUnmount(() => {
  document.removeEventListener(
    'mousedown',
    closeHeaderFormatMenuOnOutsideClick
  );
});
</script>

<template>
  <section class="template-editor__section">
    <h3 class="template-editor__heading">
      {{ t('whatsapp_template_content_heading') }}
    </h3>
    <p class="template-editor__hint">
      {{ t('whatsapp_template_content_hint') }}
      <a
        href="https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('whatsapp_template_about_templates') }}
      </a>
    </p>

    <div class="template-editor__compact-grid">
      <div class="template-editor__select-block">
        <VTooltip
          location="top"
          max-width="360"
          content-class="template-editor__tooltip"
        >
          <template #activator="{ props: tooltipProps }">
            <div
              v-bind="tooltipProps"
              class="template-editor__inline-label template-editor__inline-label--trailing-info"
            >
              <span>{{ t('whatsapp_template_parameter_type_label') }}</span>
              <VIcon
                icon="tabler-info-circle"
                size="15"
                class="template-editor__info-icon"
              />
            </div>
          </template>
          <strong>{{ t('whatsapp_template_parameter_type_label') }}</strong>
          <p class="mb-0">
            {{ parameterTypeTooltip() }}
          </p>
        </VTooltip>
        <AppSelect
          v-model="draft.parameter_format"
          :aria-label="t('whatsapp_template_parameter_type_label')"
          :items="parameterFormatOptions"
          item-title="title"
          item-value="value"
        />
      </div>

      <div class="template-editor__select-block">
        <div class="template-editor__inline-label">
          <span>{{ t('whatsapp_template_media_sample_label') }}</span>
          <span class="template-editor__optional">
            • {{ t('whatsapp_template_optional') }}
          </span>
        </div>
        <div
          ref="headerFormatSelectRef"
          class="template-editor__header-format-control"
        >
          <button
            class="template-editor__header-format-select"
            type="button"
            :aria-label="t('whatsapp_template_media_sample_label')"
            :aria-expanded="headerFormatMenu"
            @click.stop="toggleHeaderFormatMenu"
            @keydown.enter.prevent.stop="toggleHeaderFormatMenu"
            @keydown.space.prevent.stop="toggleHeaderFormatMenu"
            @keydown.esc.prevent.stop="headerFormatMenu = false"
          >
            <span class="template-editor__header-format-selected">
              <VIcon
                v-if="selectedHeaderFormatOption?.icon"
                :icon="selectedHeaderFormatOption.icon"
                size="18"
              />
              <span>{{ selectedHeaderFormatOption?.title }}</span>
            </span>
            <VIcon
              :icon="
                headerFormatMenu ? 'tabler-chevron-up' : 'tabler-chevron-down'
              "
              size="18"
            />
          </button>
          <div
            v-if="headerFormatMenu"
            class="template-editor__header-format-menu"
            role="listbox"
            :aria-label="t('whatsapp_template_media_sample_label')"
          >
            <button
              v-for="option in headerFormatOptions"
              :key="option.value"
              class="template-editor__header-format-option"
              :class="{
                'template-editor__header-format-option--active':
                  draft.header_format === option.value,
              }"
              type="button"
              role="option"
              :aria-selected="draft.header_format === option.value"
              @pointerdown.prevent.stop="updateHeaderFormat(option.value)"
              @click.prevent.stop
              @keydown.enter.prevent.stop="updateHeaderFormat(option.value)"
              @keydown.space.prevent.stop="updateHeaderFormat(option.value)"
            >
              <VIcon v-if="option.icon" :icon="option.icon" size="18" />
              <span>{{ option.title }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="mediaHeaderFormats.includes(draft.header_format)"
      class="template-editor__media-upload-wrapper"
    >
      <input
        ref="mediaInputRef"
        class="template-editor__media-input"
        type="file"
        :accept="mediaInputAccept"
        :aria-label="t('whatsapp_template_media_upload_label')"
        @change="handleMediaInput"
      />
      <div
        v-if="props.mediaAttachment"
        class="template-editor__media-attachment"
      >
        <div class="template-editor__media-attachment-preview">
          <img
            v-if="
              props.mediaAttachment.format === 'IMAGE' &&
              props.mediaAttachment.url
            "
            :src="props.mediaAttachment.url"
            :alt="props.mediaAttachment.name"
          />
          <VIcon v-else :icon="mediaAttachmentIcon" size="22" />
        </div>
        <span class="template-editor__media-attachment-name">
          {{ props.mediaAttachment.name }}
        </span>
        <IconBtn
          size="small"
          :aria-label="t('whatsapp_template_media_remove')"
          @click="emit('removeMediaFile')"
        >
          <VIcon icon="tabler-x" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_media_remove') }}
          </VTooltip>
        </IconBtn>
      </div>
      <button
        v-else
        class="template-editor__media-upload"
        :class="{ 'template-editor__media-upload--dragging': isDraggingFile }"
        type="button"
        :disabled="props.uploading"
        @click="openMediaPicker"
        @dragenter.prevent="isDraggingFile = true"
        @dragover.prevent="isDraggingFile = true"
        @dragleave.prevent="isDraggingFile = false"
        @drop.prevent="handleDrop"
      >
        <div class="template-editor__media-upload-copy">
          <strong>{{ t('whatsapp_template_media_drop_title') }}</strong>
          <span>
            {{ t('whatsapp_template_media_drop_hint_prefix') }}
            <span class="template-editor__media-upload-link">
              {{ t('whatsapp_template_media_drop_link') }}
            </span>
            {{ t('whatsapp_template_media_drop_hint_suffix') }}
          </span>
          <span v-if="draft.header_handle" class="template-editor__media-ready">
            <VIcon icon="tabler-circle-check" size="16" />
            {{ t('whatsapp_template_media_uploaded') }}
          </span>
        </div>
      </button>
      <div
        v-if="headerMediaError && !props.uploading"
        class="template-editor__field-error template-editor__media-error"
      >
        {{ headerMediaError }}
      </div>
    </div>

    <div class="template-editor__field-stack">
      <VTooltip
        location="top"
        max-width="360"
        content-class="template-editor__tooltip"
        :disabled="!textHeaderDisabledTooltip"
      >
        <template #activator="{ props: tooltipProps }">
          <div v-bind="tooltipProps">
            <AppTextField
              v-model="draft.header_text"
              :label="t('whatsapp_template_header_label')"
              :placeholder="t('whatsapp_template_header_placeholder')"
              maxlength="60"
              :counter="60"
              :disabled="isTextHeaderDisabled"
              :error-messages="headerTextError ? [headerTextError] : []"
            />
          </div>
        </template>
        {{ textHeaderDisabledTooltip }}
      </VTooltip>
      <div class="template-editor__field-actions">
        <VBtn
          variant="text"
          size="small"
          prepend-icon="tabler-plus"
          :disabled="isTextHeaderDisabled || headerVariables.length >= 1"
          @click="emit('insertHeaderVariable')"
        >
          {{ t('whatsapp_template_add_variable') }}
        </VBtn>
        <VTooltip
          location="left"
          max-width="320"
          content-class="template-editor__tooltip"
        >
          <template #activator="{ props: tooltipProps }">
            <VIcon
              v-bind="tooltipProps"
              icon="tabler-info-circle"
              size="16"
              class="template-editor__info-icon"
            />
          </template>
          {{ t('whatsapp_template_variable_tooltip') }}
        </VTooltip>
      </div>
    </div>

    <div class="template-editor__field-stack">
      <AppTextarea
        v-model="draft.body_text"
        :label="t('whatsapp_template_body_label')"
        rows="8"
        maxlength="1024"
        :counter="1024"
        :error-messages="bodyTextError ? [bodyTextError] : []"
      />
      <div class="template-editor__body-tools">
        <IconBtn size="small" @click="emit('insertBodyMarkup', '🙂')">
          <VIcon icon="tabler-mood-smile" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_tool_emoji') }}
          </VTooltip>
        </IconBtn>
        <IconBtn
          size="small"
          @click="emit('insertBodyMarkup', wrapMarkup('*'))"
        >
          <VIcon icon="tabler-bold" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_tool_bold') }}
          </VTooltip>
        </IconBtn>
        <IconBtn
          size="small"
          @click="emit('insertBodyMarkup', wrapMarkup('_'))"
        >
          <VIcon icon="tabler-italic" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_tool_italic') }}
          </VTooltip>
        </IconBtn>
        <IconBtn
          size="small"
          @click="emit('insertBodyMarkup', wrapMarkup('~'))"
        >
          <VIcon icon="tabler-strikethrough" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_tool_strikethrough') }}
          </VTooltip>
        </IconBtn>
        <IconBtn
          size="small"
          @click="emit('insertBodyMarkup', wrapMarkup('`'))"
        >
          <VIcon icon="tabler-code" />
          <VTooltip activator="parent">
            {{ t('whatsapp_template_tool_code') }}
          </VTooltip>
        </IconBtn>
        <VBtn
          variant="text"
          size="small"
          prepend-icon="tabler-plus"
          @click="emit('insertBodyVariable')"
        >
          {{ t('whatsapp_template_add_variable') }}
        </VBtn>
        <VTooltip
          location="left"
          max-width="320"
          content-class="template-editor__tooltip"
        >
          <template #activator="{ props: tooltipProps }">
            <VIcon
              v-bind="tooltipProps"
              icon="tabler-info-circle"
              size="16"
              class="template-editor__info-icon"
            />
          </template>
          {{ t('whatsapp_template_variable_tooltip') }}
        </VTooltip>
      </div>
    </div>

    <WhatsappTemplateVariableSamples
      v-model="draft"
      :header-variables="headerVariables"
      :body-variables="bodyVariables"
    />

    <AppTextField
      v-model="draft.footer_text"
      :label="t('whatsapp_template_footer_label')"
      :placeholder="t('whatsapp_template_footer_placeholder')"
      maxlength="60"
      :counter="60"
      :error-messages="footerTextError ? [footerTextError] : []"
      class="mt-4"
    />
  </section>
</template>

<style scoped>
.template-editor__header-format-control {
  position: relative;
}

.template-editor__header-format-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  inline-size: 100%;
  min-block-size: 38px;
  padding: 0 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  cursor: pointer;
  font: inherit;
  outline: none;
  text-align: start;
}

.template-editor__header-format-select:focus-visible {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}

.template-editor__header-format-selected {
  display: inline-flex;
  align-items: center;
  min-inline-size: 0;
  gap: 8px;
}

.template-editor__header-format-selected span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-editor__header-format-menu {
  position: absolute;
  z-index: 20;
  inset-block-start: calc(100% + 4px);
  inset-inline-start: 0;
  display: grid;
  min-inline-size: 240px;
  padding: 4px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.14);
}

.template-editor__header-format-option {
  display: flex;
  align-items: center;
  inline-size: 100%;
  min-block-size: 40px;
  gap: 10px;
  padding: 0 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  cursor: pointer;
  font: inherit;
  outline: none;
  text-align: start;
}

.template-editor__header-format-option:hover,
.template-editor__header-format-option--active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.template-editor__header-format-option:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}
</style>
