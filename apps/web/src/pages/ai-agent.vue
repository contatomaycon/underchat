<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EAiAgentPermissions } from '@core/common/enums/EPermissions/aiAgent';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { useVoiceIaStore } from '@/@webcore/stores/voiceIa';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListAiAgentResponse } from '@core/schema/aiAgent/listAiAgent/response.schema';
import AppAddAiAgent from '@/components/aiAgent/AppAddAiAgent.vue';
import AppEditAiAgent from '@/components/aiAgent/AppEditAiAgent.vue';
import AppAiAgentUsage from '@/components/aiAgent/AppAiAgentUsage.vue';
import AppManageAiAgentPrompt from '@/components/aiAgent/AppManageAiAgentPrompt.vue';
import AppHumanTransferAiAgent from '@/components/aiAgent/AppHumanTransferAiAgent.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import TablePagination from '@/@webcore/components/TablePagination.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAiAgentPermissions.ai_agent_group,
      EAiAgentPermissions.ai_agent_view,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAiAgentPermissions.ai_agent_group,
  EAiAgentPermissions.ai_agent_create,
];

const { t } = useI18n();
const aiAgentStore = useAiAgentStore();
const voiceIaStore = useVoiceIaStore();
useSnackbarCleanup(aiAgentStore);

const canCreateAiAgent = ref(false);
const aiAgentConfigTooltip = ref('');

onMounted(async () => {
  const config = await aiAgentStore.fetchAiAgentConfig();
  if (!config?.enabled || !config?.ai_agent || config.ai_agent <= 0) {
    canCreateAiAgent.value = false;
    aiAgentConfigTooltip.value = t('ai_agent_not_available_plan_message');
    return;
  }

  if (config.total >= config.ai_agent) {
    canCreateAiAgent.value = false;
    aiAgentConfigTooltip.value = t('ai_agent_not_available_additional');
    return;
  }

  canCreateAiAgent.value = true;

  voiceIaStore.listActiveVoiceIas();
});

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const aiAgentToDelete = ref<string | null>(null);
const aiAgentPlanBlockAction = ref<{
  aiAgentId: string;
  action: 'block' | 'unblock';
} | null>(null);

const isDialogEditAiAgentShow = ref(false);
const isAddAiAgentVisible = ref(false);
const aiAgentToEdit = ref<string | null>(null);
const isPromptDialogVisible = ref(false);
const aiAgentForPrompt = ref<string | null>(null);
const isUsageDialogVisible = ref(false);
const aiAgentForUsage = ref<string | null>(null);
const isHumanTransferDialogVisible = ref(false);
const aiAgentForHumanTransfer = ref<string | null>(null);

const headers: DataTableHeader<ListAiAgentResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('ai_agent_type'), key: 'ai_agent_type_name' },
  { title: t('base_url'), key: 'base_url' },
  { title: t('status'), key: 'status' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => {
  return {
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    name: debouncedSearch.value,
  };
});

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteAiAgent = async (id: string) => {
  aiAgentToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!aiAgentToDelete.value) return;

  const result = await aiAgentStore.deleteAiAgent(aiAgentToDelete.value);
  if (result) {
    await aiAgentStore.listAiAgents(query.value);

    const config = await aiAgentStore.fetchAiAgentConfig(true);
    if (config?.enabled && config?.ai_agent && config.ai_agent > 0) {
      if (config.total < config.ai_agent) {
        canCreateAiAgent.value = true;
        aiAgentConfigTooltip.value = '';
      }
    }
  }

  aiAgentToDelete.value = null;
};

const isAiAgentBlockedByPlan = (item: ListAiAgentResponse): boolean =>
  item.status !== EAiAgentStatus.active;

const isDialogAiAgentPlanBlockShow = computed({
  get: () => aiAgentPlanBlockAction.value !== null,
  set: (value: boolean) => {
    if (!value) {
      aiAgentPlanBlockAction.value = null;
    }
  },
});

const aiAgentPlanBlockDialogTitle = computed(() => {
  const action = aiAgentPlanBlockAction.value?.action ?? 'block';

  return `${t(action)} ${t('ai_agent')}`;
});

const aiAgentPlanBlockDialogMessage = computed(() => {
  const action = aiAgentPlanBlockAction.value?.action ?? 'block';

  return t(
    action === 'block'
      ? 'block_ai_agent_confirmation'
      : 'unblock_ai_agent_confirmation'
  );
});

const openAiAgentPlanBlockDialog = (item: ListAiAgentResponse) => {
  aiAgentPlanBlockAction.value = {
    aiAgentId: item.ai_agent_id,
    action: isAiAgentBlockedByPlan(item) ? 'unblock' : 'block',
  };
};

const handleAiAgentPlanBlock = async () => {
  if (!aiAgentPlanBlockAction.value) {
    return;
  }

  const { aiAgentId, action } = aiAgentPlanBlockAction.value;
  const result =
    action === 'block'
      ? await aiAgentStore.blockAiAgent(aiAgentId)
      : await aiAgentStore.unblockAiAgent(aiAgentId);

  if (result) {
    await aiAgentStore.listAiAgents(query.value);
    await aiAgentStore.fetchAiAgentConfig();
  }

  aiAgentPlanBlockAction.value = null;
};

const openEditDialog = (id: string) => {
  aiAgentToEdit.value = id;
  nextTick(() => {
    isDialogEditAiAgentShow.value = true;
  });
};

const openPromptDialog = (id: string) => {
  aiAgentForPrompt.value = id;
  nextTick(() => {
    isPromptDialogVisible.value = true;
  });
};

const openUsageDialog = (id: string) => {
  aiAgentForUsage.value = id;
  nextTick(() => {
    isUsageDialogVisible.value = true;
  });
};

const openHumanTransferDialog = (id: string) => {
  aiAgentForHumanTransfer.value = id;
  nextTick(() => {
    isHumanTransferDialogVisible.value = true;
  });
};

const handleCreated = async () => {
  await aiAgentStore.listAiAgents(query.value);

  const config = await aiAgentStore.fetchAiAgentConfig(true);
  if (!config?.enabled || !config?.ai_agent || config.ai_agent <= 0) {
    canCreateAiAgent.value = false;
    aiAgentConfigTooltip.value = t('ai_agent_not_available_plan_message');
    return;
  }

  if (config.total >= config.ai_agent) {
    canCreateAiAgent.value = false;
    aiAgentConfigTooltip.value = t('ai_agent_not_available_additional');
    return;
  }

  canCreateAiAgent.value = true;
};

const handleUpdated = async () => {
  await aiAgentStore.listAiAgents(query.value);
};

watch(
  () => query.value,
  async () => {
    await aiAgentStore.listAiAgents(query.value);
  },
  { immediate: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('ai_agent')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center mt-5">
            <VTooltip
              v-if="
                $canPermission(permissionsCreate) &&
                !canCreateAiAgent &&
                aiAgentConfigTooltip
              "
              :text="aiAgentConfigTooltip"
              location="end"
            >
              <template #activator="{ props }">
                <span v-bind="props" class="d-inline-block">
                  <VBtn
                    :disabled="!canCreateAiAgent"
                    prepend-icon="tabler-plus"
                    @click="isAddAiAgentVisible = true"
                  >
                    {{ $t('add') }}
                  </VBtn>
                </span>
              </template>
            </VTooltip>
            <VBtn
              v-else-if="$canPermission(permissionsCreate)"
              prepend-icon="tabler-plus"
              @click="isAddAiAgentVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
              <AppTextField
                :placeholder="$t('search') + '...'"
                append-inner-icon="tabler-search"
                single-line
                hide-details
                dense
                outlined
                v-model="options.search"
              />
            </div>
          </div>
        </div>

        <VDivider class="my-4" />

        <VDataTableServer
          v-model:items-per-page="options.itemsPerPage"
          v-model:page="options.page"
          v-model:sort-by="options.sortBy"
          :headers="headers"
          :items="aiAgentStore.list"
          :items-length="aiAgentStore.pagings.total"
          :loading="aiAgentStore.loading"
          class="data-table"
          @update:options="handleTableChange"
        >
          <template #item.name="{ item }">
            {{ item.name }}
          </template>

          <template #item.ai_agent_type_name="{ item }">
            {{ item.ai_agent_type_name }}
          </template>

          <template #item.base_url="{ item }">
            {{ item.base_url || '-' }}
          </template>

          <template #item.status="{ item }">
            <VChip
              :color="isAiAgentBlockedByPlan(item) ? 'error' : 'success'"
              size="small"
            >
              {{ $t(item.status) }}
            </VChip>
          </template>

          <template #item.created_at="{ item }">
            {{ formatDateTime(item.created_at ?? null) }}
          </template>

          <template #item.actions="{ item }">
            <div class="d-flex gap-2">
              <IconBtn v-if="$canPermission(permissionsEdit)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('ai_agent_usage_view') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-chart-bar"
                  @click="openUsageDialog(item.ai_agent_id)"
                />
              </IconBtn>

              <IconBtn v-if="$canPermission(permissionsEdit)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('prompt') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-message"
                  @click="openPromptDialog(item.ai_agent_id)"
                />
              </IconBtn>

              <IconBtn v-if="$canPermission(permissionsEdit)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('human_transfer') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-users"
                  @click="openHumanTransferDialog(item.ai_agent_id)"
                />
              </IconBtn>

              <IconBtn v-if="$canPermission(permissionsEdit)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('edit') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-edit"
                  @click="openEditDialog(item.ai_agent_id)"
                />
              </IconBtn>

              <IconBtn v-if="$canPermission(permissionsEdit)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>
                    {{
                      `${$t(isAiAgentBlockedByPlan(item) ? 'unblock' : 'block')} ${$t('ai_agent')}`
                    }}
                  </span>
                </VTooltip>
                <VIcon
                  :icon="
                    isAiAgentBlockedByPlan(item)
                      ? 'tabler-lock-open'
                      : 'tabler-lock'
                  "
                  @click="openAiAgentPlanBlockDialog(item)"
                />
              </IconBtn>

              <IconBtn v-if="$canPermission(permissionsDelete)">
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('delete') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-trash"
                  @click="deleteAiAgent(item.ai_agent_id)"
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
              :total-items="aiAgentStore.pagings.total"
            />
          </template>
        </VDataTableServer>
      </VCardText>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete') + ' ' + $t('ai_agent')"
        :message="$t('delete_ai_agent_confirmation')"
        @confirm="handleDelete"
      />

      <VDialogHandler
        v-if="isDialogAiAgentPlanBlockShow"
        v-model="isDialogAiAgentPlanBlockShow"
        :title="aiAgentPlanBlockDialogTitle"
        :message="aiAgentPlanBlockDialogMessage"
        @confirm="handleAiAgentPlanBlock"
      />

      <AppEditAiAgent
        v-if="isDialogEditAiAgentShow"
        v-model="isDialogEditAiAgentShow"
        :ai-agent-id="aiAgentToEdit"
        @updated="handleUpdated"
      />

      <AppAddAiAgent
        v-if="isAddAiAgentVisible"
        v-model="isAddAiAgentVisible"
        @created="handleCreated"
      />

      <AppManageAiAgentPrompt
        v-if="isPromptDialogVisible"
        v-model="isPromptDialogVisible"
        :ai-agent-id="aiAgentForPrompt"
      />

      <AppAiAgentUsage
        v-if="isUsageDialogVisible"
        v-model="isUsageDialogVisible"
        :ai-agent-id="aiAgentForUsage"
      />

      <AppHumanTransferAiAgent
        v-if="isHumanTransferDialogVisible"
        v-model="isHumanTransferDialogVisible"
        :ai-agent-id="aiAgentForHumanTransfer"
      />
    </VCard>

    <VSnackbar
      v-model="aiAgentStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="aiAgentStore.snackbar.color"
    >
      {{ aiAgentStore.snackbar.message }}
    </VSnackbar>
  </div>
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

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
