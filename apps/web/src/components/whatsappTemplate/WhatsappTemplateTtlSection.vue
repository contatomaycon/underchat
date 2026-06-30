<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SelectOption, TemplateDraft } from './types';

defineProps<{
  ttlOptions: SelectOption<number>[];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
</script>

<template>
  <section class="template-editor__section">
    <div class="template-editor__ttl-header">
      <div>
        <h3 class="template-editor__heading mb-1">
          {{ t('whatsapp_template_ttl_heading') }}
        </h3>
        <p class="template-editor__hint mb-0">
          {{ t('whatsapp_template_ttl_hint') }}
        </p>
        <strong class="d-block mt-3">
          {{ t('whatsapp_template_ttl_custom_heading') }}
        </strong>
        <span class="template-editor__muted">
          {{ t('whatsapp_template_ttl_default_hint') }}
        </span>
      </div>
      <VSwitch
        v-model="draft.custom_ttl_enabled"
        color="primary"
        hide-details
        inset
      />
    </div>
    <AppSelect
      v-if="draft.custom_ttl_enabled"
      v-model="draft.message_send_ttl_seconds"
      :label="t('whatsapp_template_ttl_label')"
      :items="ttlOptions"
      item-title="title"
      item-value="value"
      class="mt-4"
    />
  </section>
</template>
