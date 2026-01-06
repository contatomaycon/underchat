<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { DataTableHeader } from 'vuetify';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import AppAddEditAiAgentPrompt from './AppAddEditAiAgentPrompt.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  aiAgentId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentId = computed(() => props.aiAgentId);
const isLoading = ref(false);
const isDeleting = ref(false);
const isAddEditModalVisible = ref(false);
const promptToEdit = ref<string | null>(null);
const promptToDelete = ref<string | null>(null);
const isDeleteDialogVisible = ref(false);

const headers: DataTableHeader<ListAiAgentPromptResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('ai_agent_prompt_type'), key: 'ai_agent_prompt_type' },
  { title: t('value'), key: 'value' },
  { title: t('status'), key: 'status' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const loadPrompts = async () => {
  if (!aiAgentId.value) return;

  isLoading.value = true;
  try {
    await aiAgentStore.listAiAgentPrompts(aiAgentId.value);
  } finally {
    isLoading.value = false;
  }
};

const openAddModal = () => {
  promptToEdit.value = null;
  isAddEditModalVisible.value = true;
};

const openEditModal = (promptId: string) => {
  promptToEdit.value = promptId;
  isAddEditModalVisible.value = true;
};

const handleDelete = async () => {
  if (!promptToDelete.value) return;

  isDeleting.value = true;
  try {
    const result = await aiAgentStore.deleteAiAgentPrompt(promptToDelete.value);
    if (result) {
      await loadPrompts();
    }
  } finally {
    isDeleting.value = false;
    promptToDelete.value = null;
    isDeleteDialogVisible.value = false;
  }
};

const deletePrompt = (promptId: string) => {
  promptToDelete.value = promptId;
  isDeleteDialogVisible.value = true;
};

const handleCreated = async () => {
  await loadPrompts();
};

const handleUpdated = async () => {
  await loadPrompts();
};

const getPromptTypeLabel = (type: EAiAgentPromptType): string => {
  if (type === EAiAgentPromptType.file) {
    return t('file');
  }
  return t('text');
};

const truncateValue = (value: string, maxLength: number = 50): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.substring(0, maxLength) + '...';
};

watch(isVisible, (newValue) => {
  if (newValue && aiAgentId.value) {
    loadPrompts();
  }
});

onMounted(() => {
  if (isVisible.value && aiAgentId.value) {
    loadPrompts();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="900" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('prompt') }} - {{ $t('ai_agent') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isLoading"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <div class="d-flex justify-end mb-4">
          <VBtn
            prepend-icon="tabler-plus"
            color="primary"
            @click="openAddModal"
            :disabled="isLoading"
            :loading="aiAgentStore.loading"
          >
            {{ $t('add') }} {{ $t('prompt') }}
          </VBtn>
        </div>

        <VDataTable
          :headers="headers"
          :items="aiAgentStore.prompts"
          :loading="isLoading"
          class="data-table"
        >
          <template #item.name="{ item }">
            {{ item.name }}
          </template>

          <template #item.ai_agent_prompt_type="{ item }">
            <VChip size="small" color="primary">
              {{ getPromptTypeLabel(item.ai_agent_prompt_type) }}
            </VChip>
          </template>

          <template #item.value="{ item }">
            {{ truncateValue(item.value) }}
          </template>

          <template #item.status="{ item }">
            <VChip
              :color="item.status === 'active' ? 'success' : 'error'"
              size="small"
            >
              {{ $t(item.status) }}
            </VChip>
          </template>

          <template #item.actions="{ item }">
            <div class="d-flex gap-2">
              <IconBtn>
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('edit') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-edit"
                  @click="openEditModal(item.ai_agent_prompt_id)"
                />
              </IconBtn>

              <IconBtn>
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('delete') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-trash"
                  @click="deletePrompt(item.ai_agent_prompt_id)"
                />
              </IconBtn>
            </div>
          </template>

          <template #no-data>
            {{ $t('no_data_available') }}
          </template>
        </VDataTable>
      </VCardText>
    </VCard>

    <VDialog
      v-if="isDeleteDialogVisible"
      v-model="isDeleteDialogVisible"
      persistent
      class="v-dialog-sm"
    >
      <DialogCloseBtn
        @click="isDeleteDialogVisible = false"
        :disabled="isDeleting"
      />

      <VCard :title="$t('delete') + ' ' + $t('prompt')">
        <VCardText>{{ $t('delete_prompt_confirmation') }}</VCardText>

        <VCardText class="d-flex justify-end gap-3 flex-wrap">
          <VBtn
            color="secondary"
            variant="tonal"
            @click="isDeleteDialogVisible = false"
            :disabled="isDeleting"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="handleDelete" :loading="isDeleting">
            {{ $t('confirm') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <AppAddEditAiAgentPrompt
      v-if="isAddEditModalVisible"
      v-model="isAddEditModalVisible"
      :ai-agent-id="aiAgentId"
      :prompt-id="promptToEdit"
      @created="handleCreated"
      @updated="handleUpdated"
    />
  </VDialog>
</template>

<style lang="scss" scoped>
.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }

  :deep(
    .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
  ) {
    color: inherit;
  }
}
</style>
