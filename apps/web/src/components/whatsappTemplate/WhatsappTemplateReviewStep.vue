<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TemplateDraft } from './types';

defineProps<{
  componentsCount: number;
  firstValidationError: string;
  isEditingRemote: boolean;
  selectedLanguageTitle: string;
  summarySubtitle: string;
  validationErrors: string[];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
</script>

<template>
  <section class="template-editor__section">
    <h3 class="template-editor__heading">
      {{ t('whatsapp_template_submit_heading') }}
    </h3>
    <div class="template-editor__review">
      <div>
        <strong>{{ draft.name || t('whatsapp_template_unnamed') }}</strong>
        <span>{{ selectedLanguageTitle }}</span>
      </div>
      <div>
        <strong>{{ summarySubtitle }}</strong>
        <span>{{ draft.parameter_format }}</span>
      </div>
      <div>
        <strong>{{ componentsCount }}</strong>
        <span>{{ t('whatsapp_template_components_configured') }}</span>
      </div>
    </div>

    <VAlert
      v-if="validationErrors.length"
      type="error"
      variant="tonal"
      class="mt-4"
    >
      {{ firstValidationError }}
    </VAlert>
    <VAlert v-else type="success" variant="tonal" class="mt-4">
      {{ t('whatsapp_template_ready_for_review') }}
    </VAlert>
    <VAlert v-if="isEditingRemote" type="info" variant="tonal" class="mt-4">
      {{ t('whatsapp_template_remote_edit_notice') }}
    </VAlert>
  </section>
</template>
