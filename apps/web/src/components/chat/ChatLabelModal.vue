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

const labelSearchQuery = ref('');
const isLabelMenuOpen = ref(false);

const filteredLabelTemplates = computed(() => {
  if (!labelSearchQuery.value) {
    return labelTemplates.value;
  }
  const query = labelSearchQuery.value.toLowerCase();
  return labelTemplates.value.filter((label) =>
    label.label.toLowerCase().includes(query)
  );
});

watch(isLabelMenuOpen, (isOpen) => {
  if (!isOpen) {
    labelSearchQuery.value = '';
  }
});
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

    <VOverlay
      :model-value="isLoadingLabels || isSavingLabel"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="t('label')">
      <VCardText>
        <VLabel class="mb-1 text-body-2">{{ t('label') }}:</VLabel>
        <VMenu v-model="isLabelMenuOpen">
          <template #activator="{ props: menuProps }">
            <VTextField
              v-bind="menuProps"
              :model-value="
                filteredLabelTemplates.find(
                  (label) => label.label_template_id === selectedLabelTemplateId
                )?.label || ''
              "
              :placeholder="t('select_label')"
              variant="outlined"
              readonly
              :clearable="!!selectedLabelTemplateId"
              clear-icon="tabler-x"
              @click:clear="selectedLabelTemplateId = null"
              :append-inner-icon="
                selectedLabelTemplateId ? undefined : 'tabler-chevron-down'
              "
              class="label-select"
            >
              <template #prepend-inner>
                <div
                  v-if="
                    filteredLabelTemplates.find(
                      (label) =>
                        label.label_template_id === selectedLabelTemplateId
                    )
                  "
                  class="label-color-circle me-2"
                  :style="{
                    backgroundColor: filteredLabelTemplates.find(
                      (label) =>
                        label.label_template_id === selectedLabelTemplateId
                    )?.color,
                  }"
                />
              </template>
            </VTextField>
          </template>
          <VCard>
            <VCardText class="pa-2">
              <AppTextField
                v-model="labelSearchQuery"
                :placeholder="t('search') + '...'"
                prepend-inner-icon="tabler-search"
                density="compact"
                hide-details
                autofocus
                @click.stop
              />
            </VCardText>
            <VDivider />
            <VList max-height="300" style="overflow-y: auto">
              <template v-if="filteredLabelTemplates.length > 0">
                <VListItem
                  v-for="(item, index) in filteredLabelTemplates"
                  :key="index"
                  :value="item.label_template_id"
                  @click="
                    () => {
                      selectedLabelTemplateId = item.label_template_id;
                      isLabelMenuOpen = false;
                      labelSearchQuery = '';
                    }
                  "
                  :active="selectedLabelTemplateId === item.label_template_id"
                >
                  <template #prepend>
                    <div
                      class="label-color-circle"
                      :style="{ backgroundColor: item.color }"
                    />
                  </template>
                  <VListItemTitle>{{ item.label }}</VListItemTitle>
                </VListItem>
              </template>
              <VListItem v-else-if="labelSearchQuery" disabled>
                <VListItemTitle
                  class="text-center text-body-2 text-medium-emphasis"
                >
                  {{ t('no_results_found') }}
                </VListItemTitle>
              </VListItem>
            </VList>
          </VCard>
        </VMenu>
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
