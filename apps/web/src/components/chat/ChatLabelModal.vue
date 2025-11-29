<script lang="ts" setup>
import { ref, watch, computed } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const chatStore = useChatStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const labelTemplates = ref<
  Array<{ label_template_id: string; label: string; color: string }>
>([]);
const selectedLabelTemplateId = ref<string | null>(null);
const isLoadingLabels = ref(false);
const isSavingLabel = ref(false);

const openLabelModal = async () => {
  isOpen.value = true;
  isLoadingLabels.value = true;

  const labels = await chatStore.listLabelTemplates();

  if (labels) {
    labelTemplates.value = labels;
  }

  selectedLabelTemplateId.value =
    chatStore.activeChat?.label?.label_template_id || null;
  isLoadingLabels.value = false;
};

const closeLabelModal = () => {
  if (isSavingLabel.value) return;
  isOpen.value = false;
  selectedLabelTemplateId.value = null;
};

const saveLabel = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  isSavingLabel.value = true;

  const success = await chatStore.updateChatLabel(
    chatStore.activeChat.chat_id,
    selectedLabelTemplateId.value || null
  );

  if (success) {
    isOpen.value = false;
  }

  isSavingLabel.value = false;
};

const removeLabel = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  isSavingLabel.value = true;

  const success = await chatStore.updateChatLabel(
    chatStore.activeChat.chat_id,
    null
  );

  if (success) {
    isOpen.value = false;
  }

  isSavingLabel.value = false;
};

watch(
  () => props.modelValue,
  (isOpenValue) => {
    if (isOpenValue) {
      openLabelModal();
    }
  }
);
</script>

<template>
  <VDialog
    :model-value="isOpen"
    max-width="500"
    :persistent="isSavingLabel"
    @update:model-value="isOpen = $event"
  >
    <DialogCloseBtn :disabled="isSavingLabel" @click="closeLabelModal" />

    <VCard :title="t('label')">
      <VCardText>
        <VProgressLinear
          v-if="isLoadingLabels"
          indeterminate
          color="primary"
          class="mb-4"
        />

        <VSelect
          v-else
          v-model="selectedLabelTemplateId"
          :items="labelTemplates"
          item-title="label"
          item-value="label_template_id"
          :label="t('label')"
          :placeholder="t('select_label')"
          clearable
          class="label-select"
        >
          <template #item="{ props, item }">
            <VListItem v-bind="props">
              <template #prepend>
                <div
                  class="label-color-circle"
                  :style="{ backgroundColor: item.raw.color }"
                />
              </template>
            </VListItem>
          </template>
          <template #selection="{ item }">
            <div v-if="item.raw" class="d-flex align-center">
              <div
                class="label-color-circle"
                :style="{ backgroundColor: item.raw.color }"
              />
              <span class="ms-2">{{ item.raw.label }}</span>
            </div>
          </template>
        </VSelect>
      </VCardText>

      <VCardText class="d-flex justify-space-between flex-wrap gap-3">
        <VBtn
          v-if="chatStore.activeChat?.label"
          variant="tonal"
          color="error"
          :loading="isSavingLabel"
          :disabled="isSavingLabel"
          @click="removeLabel"
        >
          {{ t('remove') }}
        </VBtn>
        <VSpacer />
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingLabel"
          @click="closeLabelModal"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingLabel"
          :disabled="isSavingLabel"
          @click="saveLabel"
        >
          {{ t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.label-select {
  .v-field__input {
    > .v-select__selection {
      margin: 0;
      display: flex;
      align-items: center;

      > span:not(.label-color-circle):not(:has(.label-color-circle)),
      > .v-select__selection-text {
        display: none !important;
      }
    }
  }

  .v-select__selection {
    .v-select__selection-text {
      display: none !important;
    }

    > span:not(:has(.label-color-circle)):not(.label-color-circle) {
      display: none !important;
    }
  }

  .v-list-item__prepend {
    margin-inline-end: 12px;
  }
}

.label-color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-inline-end: 8px;
}
</style>
