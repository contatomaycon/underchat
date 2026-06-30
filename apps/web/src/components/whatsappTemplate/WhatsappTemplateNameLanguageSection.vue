<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SelectOption, TemplateDraft } from './types';

defineProps<{
  isEditingRemote: boolean;
  languageOptions: SelectOption[];
  selectedLanguageTitle: string;
  summarySubtitle: string;
  templateNameError: string;
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
</script>

<template>
  <section class="template-editor__summary">
    <div class="template-editor__summary-icon">
      <VIcon icon="tabler-speakerphone" size="26" />
    </div>
    <div>
      <strong>
        {{ draft.name || t('whatsapp_template_default_name') }} •
        {{ selectedLanguageTitle }}
      </strong>
      <span>{{ summarySubtitle }}</span>
    </div>
  </section>

  <section class="template-editor__section">
    <h3 class="template-editor__heading">
      {{ t('whatsapp_template_name_language_heading') }}
    </h3>
    <div class="template-editor__name-grid">
      <AppTextField
        v-model="draft.name"
        :label="t('whatsapp_template_name_label')"
        :placeholder="t('whatsapp_template_name_placeholder')"
        :disabled="isEditingRemote"
        maxlength="512"
        :counter="512"
        :error-messages="templateNameError ? [templateNameError] : []"
      />
      <AppAutocomplete
        v-model="draft.language"
        :label="t('whatsapp_template_language_label')"
        :placeholder="t('whatsapp_template_language_placeholder')"
        :items="languageOptions"
        item-title="title"
        item-value="value"
        :disabled="isEditingRemote"
        density="compact"
      />
    </div>
  </section>
</template>
