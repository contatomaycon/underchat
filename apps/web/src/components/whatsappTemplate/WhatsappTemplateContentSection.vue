<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import WhatsappTemplateVariableSamples from './WhatsappTemplateVariableSamples.vue';
import type {
  HeaderFormat,
  ParameterFormat,
  SelectOption,
  TemplateDraft,
} from './types';

defineProps<{
  bodyTextError: string;
  bodyVariables: string[];
  footerTextError: string;
  headerFormatOptions: SelectOption<HeaderFormat>[];
  headerTextError: string;
  headerVariables: string[];
  parameterFormatOptions: SelectOption<ParameterFormat>[];
  uploading: boolean;
}>();

const emit = defineEmits<{
  handleMediaFile: [value: File | File[] | null];
  insertBodyMarkup: [value: string];
  insertBodyVariable: [];
  insertHeaderVariable: [];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();

const mediaHeaderFormats = ['IMAGE', 'VIDEO', 'DOCUMENT'];
const nonTextHeaderFormats = [...mediaHeaderFormats, 'LOCATION'];
const markupSample = () => t('whatsapp_template_markup_sample');
const wrapMarkup = (prefix: string, suffix = prefix) =>
  `${prefix}${markupSample()}${suffix}`;
const parameterTypeTooltip = () =>
  t('whatsapp_template_parameter_type_tooltip', {
    named: '{{order_id}}',
    numeric: '{{1}}',
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
      <div class="template-editor__field-with-info">
        <AppSelect
          v-model="draft.parameter_format"
          :label="t('whatsapp_template_parameter_type_label')"
          :items="parameterFormatOptions"
          item-title="title"
          item-value="value"
        />
        <VTooltip
          location="top"
          max-width="360"
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
          <strong>{{ t('whatsapp_template_parameter_type_label') }}</strong>
          <p class="mb-0">
            {{ parameterTypeTooltip() }}
          </p>
        </VTooltip>
      </div>

      <AppSelect
        v-model="draft.header_format"
        :label="t('whatsapp_template_media_sample_label')"
        :items="headerFormatOptions"
        item-title="title"
        item-value="value"
      />
    </div>

    <div
      v-if="mediaHeaderFormats.includes(draft.header_format)"
      class="template-editor__media-grid"
    >
      <AppTextField
        v-model="draft.header_handle"
        :label="t('whatsapp_template_media_handle_label')"
        :placeholder="t('whatsapp_template_media_handle_placeholder')"
      />
      <VFileInput
        :label="t('whatsapp_template_media_upload_label')"
        density="compact"
        variant="outlined"
        :loading="uploading"
        @update:model-value="emit('handleMediaFile', $event)"
      />
    </div>

    <div
      v-if="draft.header_format === 'LOCATION'"
      class="template-editor__notice"
    >
      <VIcon icon="tabler-map-pin" size="18" />
      {{ t('whatsapp_template_location_header_notice') }}
    </div>

    <div class="template-editor__field-stack">
      <AppTextField
        v-model="draft.header_text"
        :label="t('whatsapp_template_header_label')"
        :placeholder="t('whatsapp_template_header_placeholder')"
        maxlength="60"
        :counter="60"
        :disabled="nonTextHeaderFormats.includes(draft.header_format)"
        :error-messages="headerTextError ? [headerTextError] : []"
      />
      <div class="template-editor__field-actions">
        <VBtn
          variant="text"
          size="small"
          prepend-icon="tabler-plus"
          :disabled="nonTextHeaderFormats.includes(draft.header_format)"
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
