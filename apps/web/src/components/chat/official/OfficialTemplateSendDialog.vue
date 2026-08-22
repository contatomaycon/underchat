<script setup lang="ts">
import type { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import type { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import ScheduleOfficialTemplatePicker from '@/components/schedule/ScheduleOfficialTemplatePicker.vue';
import { createUnderchatVariableCatalog } from '@/utils/underchatVariableCatalog';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    chatName?: string | null;
    templates: OfficialTemplatesResponse;
    loading?: boolean;
    submitting?: boolean;
    error?: string | null;
  }>(),
  {
    chatName: null,
    loading: false,
    submitting: false,
    error: null,
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'submit', value: IOfficialWhatsappTemplateMessage): void;
}>();

const { t } = useI18n();

const selectedTemplate = ref<IOfficialWhatsappTemplateMessage | null>(null);
const isTemplateValid = ref(false);
const availableTags = computed(() => createUnderchatVariableCatalog(t));

const isOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

watch(
  () => props.modelValue,
  (value) => {
    if (!value) {
      selectedTemplate.value = null;
      isTemplateValid.value = false;
    }
  }
);

const submit = () => {
  if (!selectedTemplate.value || !isTemplateValid.value) {
    return;
  }

  emit('submit', selectedTemplate.value);
};
</script>

<template>
  <VDialog v-model="isOpen" max-width="640" scrollable>
    <VCard>
      <VCardTitle class="official-template-dialog__title">
        <span>{{ t('official_template_conversation_modal_title') }}</span>
        <VBtn
          icon
          variant="text"
          size="small"
          :disabled="submitting"
          @click="isOpen = false"
        >
          <VIcon icon="tabler-x" size="20" />
        </VBtn>
      </VCardTitle>

      <VDivider />

      <VCardText>
        <div v-if="chatName" class="official-template-dialog__contact">
          <VIcon icon="tabler-brand-whatsapp" size="18" />
          <span>{{ chatName }}</span>
        </div>

        <ScheduleOfficialTemplatePicker
          v-model="selectedTemplate"
          :templates="templates"
          :loading="loading"
          :error="error"
          :available-tags="availableTags"
          @valid-change="isTemplateValid = $event"
        />
      </VCardText>

      <VDivider />

      <VCardActions class="official-template-dialog__actions">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="submitting"
          @click="isOpen = false"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          variant="flat"
          :loading="submitting"
          :disabled="loading || !isTemplateValid || !selectedTemplate"
          @click="submit"
        >
          <VIcon icon="tabler-send" size="16" class="me-1" />
          {{ t('official_template_conversation_send') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.official-template-dialog__title {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.official-template-dialog__contact {
  align-items: center;
  color: rgb(var(--v-theme-success));
  display: flex;
  font-size: 0.9rem;
  font-weight: 600;
  gap: 6px;
  margin-bottom: 12px;
}

.official-template-dialog__actions {
  justify-content: flex-end;
  padding: 16px 20px;
}
</style>
