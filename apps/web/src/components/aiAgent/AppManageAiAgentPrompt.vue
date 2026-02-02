<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { DataTableHeader } from 'vuetify';
import { ListAiAgentPromptResponse } from '@core/schema/aiAgent/listAiAgentPrompt/response.schema';
import { ViewAiAgentResponse } from '@core/schema/aiAgent/viewAiAgent/response.schema';
import AppAddEditAiAgentPrompt from './AppAddEditAiAgentPrompt.vue';
import TablePagination from '@/@webcore/components/TablePagination.vue';

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
const isRefreshing = ref(false);
const isAddEditModalVisible = ref(false);
const promptToEdit = ref<string | null>(null);
const promptToDelete = ref<string | null>(null);
const promptToRefresh = ref<string | null>(null);
const isDeleteDialogVisible = ref(false);
const isRefreshDialogVisible = ref(false);
const isRefreshAllDialogVisible = ref(false);
const isRefreshingAll = ref(false);
const aiAgentInfo = ref<ViewAiAgentResponse | null>(null);

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as any[],
});

const paginatedPrompts = computed(() => {
  const start = (options.value.page - 1) * options.value.itemsPerPage;
  const end = start + options.value.itemsPerPage;
  return aiAgentStore.prompts.slice(start, end);
});

const totalItems = computed(() => aiAgentStore.prompts.length);

const hasPrompts = computed(() => totalItems.value > 0);

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: any[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const headers: DataTableHeader<ListAiAgentPromptResponse>[] = [
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

const loadAiAgentInfo = async () => {
  if (!aiAgentId.value) return;

  const result = await aiAgentStore.viewAiAgent(aiAgentId.value);
  aiAgentInfo.value = result;
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

const refreshPrompt = (promptId: string) => {
  promptToRefresh.value = promptId;
  isRefreshDialogVisible.value = true;
};

const handleRefresh = async () => {
  if (!promptToRefresh.value) return;

  isRefreshing.value = true;
  try {
    const result = await aiAgentStore.refreshAiAgentPrompt(
      promptToRefresh.value
    );
    if (result) {
      await loadPrompts();
    }
  } finally {
    isRefreshing.value = false;
    promptToRefresh.value = null;
    isRefreshDialogVisible.value = false;
  }
};

const handleCreated = async () => {
  await loadPrompts();
};

const handleUpdated = async () => {
  await loadPrompts();
};

const openRefreshAllDialog = () => {
  isRefreshAllDialogVisible.value = true;
};

const handleRefreshAll = async () => {
  if (!aiAgentId.value) return;

  isRefreshingAll.value = true;
  try {
    const result = await aiAgentStore.refreshAllAiAgentPrompts(aiAgentId.value);
    if (result) {
      await loadPrompts();
    }
  } finally {
    isRefreshingAll.value = false;
    isRefreshAllDialogVisible.value = false;
  }
};

const truncateValue = (value: string, maxLength: number = 50): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return value.substring(0, maxLength) + '...';
};

watch(isVisible, (newValue) => {
  if (newValue && aiAgentId.value) {
    loadAiAgentInfo();
    loadPrompts();
  }
});

onMounted(() => {
  if (isVisible.value && aiAgentId.value) {
    loadAiAgentInfo();
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
        <div class="d-flex justify-end gap-3 mb-4">
          <VBtn
            prepend-icon="tabler-refresh"
            color="secondary"
            variant="tonal"
            @click="openRefreshAllDialog"
            :disabled="isLoading || isRefreshingAll"
            :loading="isRefreshingAll"
          >
            {{ $t('refresh_all') }}
          </VBtn>
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

        <VDataTableServer
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          v-model:sort-by="options.sortBy"
          :headers="headers"
          :items="paginatedPrompts"
          :items-length="totalItems"
          :loading="isLoading"
          class="data-table"
          @update:options="handleTableChange"
          :loading-text="$t('loading_text')"
        >
          <template #item.value="{ item }">
            <a
              :href="item.value"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary text-decoration-none d-inline-flex align-center gap-1"
            >
              <VIcon icon="tabler-external-link" size="16" />
              <span>{{ $t('view_file') }}</span>
            </a>
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
                  <span>{{ $t('refresh') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-refresh"
                  @click="refreshPrompt(item.ai_agent_prompt_id)"
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

          <template #bottom>
            <TablePagination
              v-if="options.itemsPerPage !== -1"
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="totalItems"
            />
          </template>
        </VDataTableServer>
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

    <VDialog
      v-if="isRefreshDialogVisible"
      v-model="isRefreshDialogVisible"
      persistent
      class="v-dialog-sm"
    >
      <DialogCloseBtn
        @click="isRefreshDialogVisible = false"
        :disabled="isRefreshing"
      />

      <VCard :title="$t('refresh') + ' ' + $t('prompt')">
        <VCardText>{{ $t('refresh_prompt_confirmation') }}</VCardText>

        <VCardText class="d-flex justify-end gap-3 flex-wrap">
          <VBtn
            color="secondary"
            variant="tonal"
            @click="isRefreshDialogVisible = false"
            :disabled="isRefreshing"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="handleRefresh" :loading="isRefreshing">
            {{ $t('confirm') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <VDialog
      v-if="isRefreshAllDialogVisible"
      v-model="isRefreshAllDialogVisible"
      persistent
      class="v-dialog-sm"
    >
      <DialogCloseBtn
        @click="isRefreshAllDialogVisible = false"
        :disabled="isRefreshingAll"
      />

      <VCard :title="$t('refresh_all') + ' ' + $t('prompt')">
        <VCardText>{{ $t('refresh_all_prompts_confirmation') }}</VCardText>

        <VCardText class="d-flex justify-end gap-3 flex-wrap">
          <VBtn
            color="secondary"
            variant="tonal"
            @click="isRefreshAllDialogVisible = false"
            :disabled="isRefreshingAll"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="handleRefreshAll" :loading="isRefreshingAll">
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
