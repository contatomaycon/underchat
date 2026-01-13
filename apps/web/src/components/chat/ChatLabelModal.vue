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

const selectedLabelTemplateIds = ref<string[]>([]);
const isLoadingLabels = ref(false);
const isSavingLabel = ref(false);

const itemsLabel = computed(() =>
  labelTemplates.value.map((item) => ({
    value: item.label_template_id,
    title: item.label,
    color: item.color,
  }))
);

const openLabelModal = async () => {
  isOpen.value = true;
  isLoadingLabels.value = true;

  const labels = await chatStore.listLabelTemplates();

  if (labels) {
    labelTemplates.value = labels;
  }

  selectedLabelTemplateIds.value =
    chatStore.activeChat?.label?.map((l) => l.label_template_id) ?? [];
  isLoadingLabels.value = false;
};

const closeLabelModal = () => {
  if (isSavingLabel.value) return;
  isOpen.value = false;
  selectedLabelTemplateIds.value = [];
};

const saveLabel = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  isSavingLabel.value = true;

  const success = await chatStore.updateChatLabel(
    chatStore.activeChat.chat_id,
    selectedLabelTemplateIds.value.length > 0
      ? selectedLabelTemplateIds.value
      : null
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

    <VOverlay
      :model-value="isLoadingLabels || isSavingLabel"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="t('label')">
      <VCardText>
        <AppSelectSearch
          v-model="selectedLabelTemplateIds"
          :items="itemsLabel"
          :label="t('label')"
          :placeholder="t('select_label')"
          :clearable="true"
          multiple
          chips
          closable-chips
          item-value="value"
          item-title="title"
          class="label-select"
        >
          <template #chip="{ item }">
            <div class="d-flex align-center gap-1">
              <div
                v-if="item && item.color"
                class="label-color-circle"
                :style="{ backgroundColor: item.color }"
              />
              <span>{{ item?.title }}</span>
            </div>
          </template>
          <template #prepend-inner="{ item }">
            <div
              v-if="item && !Array.isArray(item) && (item as any).color"
              class="label-color-circle me-2"
              :style="{ backgroundColor: (item as any).color }"
            />
          </template>
          <template #item-prepend="{ item }">
            <div
              v-if="item && (item as any).color"
              class="label-color-circle"
              :style="{ backgroundColor: (item as any).color }"
            />
          </template>
        </AppSelectSearch>
      </VCardText>

      <VCardText class="d-flex justify-space-between flex-wrap gap-3">
        <VBtn
          v-if="
            chatStore.activeChat?.label &&
            Array.isArray(chatStore.activeChat.label) &&
            chatStore.activeChat.label.length > 0
          "
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
