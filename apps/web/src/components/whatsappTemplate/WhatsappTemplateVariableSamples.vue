<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TemplateDraft } from './types';

defineProps<{
  headerVariables: string[];
  bodyVariables: string[];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();

const samplePlaceholder = (variable: string) =>
  t('whatsapp_template_sample_placeholder', { variable: `{{${variable}}}` });
</script>

<template>
  <div
    v-if="headerVariables.length || bodyVariables.length"
    class="template-editor__sample-panel"
  >
    <strong>{{ t('whatsapp_template_variable_samples_heading') }}</strong>
    <p>{{ t('whatsapp_template_variable_samples_hint') }}</p>

    <div v-if="headerVariables.length" class="template-editor__samples">
      <strong>{{ t('whatsapp_template_header_label') }}</strong>
      <div
        v-for="variable in headerVariables"
        :key="`header-${variable}`"
        class="template-editor__sample-row"
      >
        <AppTextField :model-value="`{{${variable}}}`" disabled hide-details />
        <AppTextField
          v-model="draft.header_variable_samples[variable]"
          :placeholder="samplePlaceholder(variable)"
          :error-messages="
            !draft.header_variable_samples[variable]?.trim()
              ? [
                  t('whatsapp_template_validation_header_sample_required', {
                    variable: `{{${variable}}}`,
                  }),
                ]
              : []
          "
        />
      </div>
    </div>

    <div v-if="bodyVariables.length" class="template-editor__samples">
      <strong>{{ t('whatsapp_template_body_label') }}</strong>
      <div
        v-for="variable in bodyVariables"
        :key="`body-${variable}`"
        class="template-editor__sample-row"
      >
        <AppTextField :model-value="`{{${variable}}}`" disabled hide-details />
        <AppTextField
          v-model="draft.body_variable_samples[variable]"
          :placeholder="samplePlaceholder(variable)"
          :error-messages="
            !draft.body_variable_samples[variable]?.trim()
              ? [
                  t('whatsapp_template_validation_body_sample_required', {
                    variable: `{{${variable}}}`,
                  }),
                ]
              : []
          "
        />
      </div>
    </div>
  </div>
</template>
