<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EColor } from '@core/common/enums/EColor';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { ListWarmChannelsResponse } from '@core/schema/config/listWarmChannels/response.schema';
import type { DataTableHeader } from 'vuetify';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useWarmChannelsStore } from '@/@webcore/stores/warmChannels';
import TablePagination from '@/@webcore/components/TablePagination.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
    ],
  },
});

const { t } = useI18n();
const warmChannelsStore = useWarmChannelsStore();
useSnackbarCleanup(warmChannelsStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: 200, title: '200' },
]);

const itemsType = ref([
  { id: EWorkerType.baileys, text: t('unofficial_socket') },
  { id: EWorkerType.wwebjs, text: t('unofficial_browser') },
  { id: EWorkerType.whatsmeow, text: t('unofficial_whatsmeow') },
]);

const headers: DataTableHeader<ListWarmChannelsResponse>[] = [
  { title: t('warm_pool_id'), key: 'warm_pool_id' },
  { title: t('server'), key: 'server' },
  { title: t('type'), key: 'type' },
  { title: t('status'), key: 'state' },
  { title: t('container_id'), key: 'container_id' },
  { title: t('container_name'), key: 'container_name' },
  { title: t('session_volume_name'), key: 'session_volume_name' },
  { title: t('last_health_at'), key: 'last_health_at' },
  { title: t('updated_date'), key: 'updated_at' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  server_id: null as string | null,
  type: null as string | null,
  warm_pool_id: null as string | null,
  container_id: null as string | null,
  container_name: null as string | null,
  session_volume_name: null as string | null,
  search: null as string | null,
  created_at_from: null as string | null,
  created_at_to: null as string | null,
  updated_at_from: null as string | null,
  updated_at_to: null as string | null,
  last_health_at_from: null as string | null,
  last_health_at_to: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  current_page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  server_id: options.value.server_id || undefined,
  type: options.value.type || undefined,
  warm_pool_id: options.value.warm_pool_id || undefined,
  container_id: options.value.container_id || undefined,
  container_name: options.value.container_name || undefined,
  session_volume_name: options.value.session_volume_name || undefined,
  search: debouncedSearch.value || undefined,
  created_at_from: options.value.created_at_from || undefined,
  created_at_to: options.value.created_at_to || undefined,
  updated_at_from: options.value.updated_at_from || undefined,
  updated_at_to: options.value.updated_at_to || undefined,
  last_health_at_from: options.value.last_health_at_from || undefined,
  last_health_at_to: options.value.last_health_at_to || undefined,
}));

const serverItems = computed(() =>
  warmChannelsStore.servers.map((item) => ({
    id: item.server_id,
    text: item.name,
  }))
);

const totalReady = computed(() => warmChannelsStore.pagings.total);
const warmChannelToRecreate = ref<string | null>(null);
const isDialogRecreatorShow = ref(false);
const isDialogRecreateAllShow = ref(false);

const resolveTypeVariant = (value: string | undefined | null) => {
  if (value === EWorkerType.baileys) {
    return { color: EColor.info, text: t('unofficial_socket') };
  }
  if (value === EWorkerType.wwebjs) {
    return { color: EColor.info, text: t('unofficial_browser') };
  }
  if (value === EWorkerType.whatsmeow) {
    return { color: EColor.info, text: t('unofficial_whatsmeow') };
  }

  return { color: EColor.error, text: t('unknown') };
};

const resolveStateVariant = (value: string | undefined | null) => {
  if (value === EWorkerWarmPoolState.ready) {
    return { color: EColor.success, text: t('ready') };
  }

  return { color: EColor.primary, text: value ?? t('unknown') };
};

const resetToFirstPage = () => {
  options.value.page = 1;
};

const clearAdvancedFilters = () => {
  options.value.warm_pool_id = null;
  options.value.container_id = null;
  options.value.container_name = null;
  options.value.session_volume_name = null;
  options.value.created_at_from = null;
  options.value.created_at_to = null;
  options.value.updated_at_from = null;
  options.value.updated_at_to = null;
  options.value.last_health_at_from = null;
  options.value.last_health_at_to = null;
  resetToFirstPage();
};

const handleTableChange = (payload: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = payload.page;
  options.value.itemsPerPage = payload.itemsPerPage;
  options.value.sortBy = payload.sortBy;
};

const recreateWarmChannel = (warmPoolId: string) => {
  warmChannelToRecreate.value = warmPoolId;
  isDialogRecreatorShow.value = true;
};

const handleRecreate = async () => {
  if (!warmChannelToRecreate.value) return;

  const result = await warmChannelsStore.recreateWarmChannel(
    warmChannelToRecreate.value
  );
  if (result) {
    await warmChannelsStore.listWarmChannels(query.value);
  }

  warmChannelToRecreate.value = null;
};

const handleRecreateAll = async () => {
  const result = await warmChannelsStore.recreateWarmChannelsAll({
    server_id: query.value.server_id,
    type: query.value.type,
    warm_pool_id: query.value.warm_pool_id,
    container_id: query.value.container_id,
    container_name: query.value.container_name,
    session_volume_name: query.value.session_volume_name,
    search: query.value.search,
    created_at_from: query.value.created_at_from,
    created_at_to: query.value.created_at_to,
    updated_at_from: query.value.updated_at_from,
    updated_at_to: query.value.updated_at_to,
    last_health_at_from: query.value.last_health_at_from,
    last_health_at_to: query.value.last_health_at_to,
  });

  if (result) {
    await warmChannelsStore.listWarmChannels(query.value);
  }
};

watch(
  query,
  async (value) => {
    await warmChannelsStore.listWarmChannels(value);
  },
  { immediate: true, deep: true }
);

watch(isDialogRecreatorShow, (isOpen) => {
  if (!isOpen) {
    warmChannelToRecreate.value = null;
  }
});

onMounted(async () => {
  await warmChannelsStore.listWarmChannelServers();
});
</script>

<template>
  <div>
    <VCard>
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('warm_channels') }}
      </VCardTitle>

      <VDivider />

      <VCardText>
        <div class="warm-summary mb-5">
          <div class="warm-summary__metric">
            <VIcon icon="tabler-flame" size="22" color="success" />
            <div>
              <div class="text-caption text-medium-emphasis">
                {{ $t('ready_warm_channels') }}
              </div>
              <div class="text-h5 font-weight-bold">{{ totalReady }}</div>
            </div>
          </div>

          <VBtn
            color="primary"
            prepend-icon="tabler-refresh"
            :disabled="totalReady === 0"
            @click="isDialogRecreateAllShow = true"
          >
            {{ $t('recreate_all') }}
          </VBtn>
        </div>

        <div class="filters-grid mb-4">
          <div class="filter-field">
            <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
            <AppSelectSearch
              v-model="options.server_id"
              :items="serverItems"
              :placeholder="$t('select_server')"
              :clearable="true"
              item-value="id"
              item-title="text"
              @update:modelValue="resetToFirstPage"
            />
          </div>

          <div class="filter-field">
            <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
            <AppSelectSearch
              v-model="options.type"
              :items="itemsType"
              :placeholder="$t('select_type')"
              :clearable="true"
              item-value="id"
              item-title="text"
              @update:modelValue="resetToFirstPage"
            />
          </div>

          <div class="filter-field">
            <VLabel class="text-body-2 mb-1">{{ $t('show') }}:</VLabel>
            <AppSelect
              :model-value="options.itemsPerPage"
              :items="itemsPerPage"
              @update:model-value="
                options.itemsPerPage = parseInt($event, 10);
                resetToFirstPage();
              "
            />
          </div>

          <div class="filter-field filter-field--wide">
            <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
            <AppTextField
              v-model="options.search"
              :placeholder="$t('search') + '...'"
              append-inner-icon="tabler-search"
              single-line
              hide-details
              dense
              outlined
            />
          </div>
        </div>

        <VExpansionPanels class="mb-4" variant="accordion">
          <VExpansionPanel>
            <VExpansionPanelTitle>
              <VIcon icon="tabler-adjustments" class="me-2" />
              {{ $t('advanced_filters') }}
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <div class="advanced-grid">
                <AppTextField
                  v-model="options.warm_pool_id"
                  :label="$t('warm_pool_id')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.container_id"
                  :label="$t('container_id')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.container_name"
                  :label="$t('container_name')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.session_volume_name"
                  :label="$t('session_volume_name')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.last_health_at_from"
                  type="datetime-local"
                  :label="$t('last_health_at_from')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.last_health_at_to"
                  type="datetime-local"
                  :label="$t('last_health_at_to')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.created_at_from"
                  type="datetime-local"
                  :label="$t('created_at_from')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.created_at_to"
                  type="datetime-local"
                  :label="$t('created_at_to')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.updated_at_from"
                  type="datetime-local"
                  :label="$t('updated_at_from')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
                <AppTextField
                  v-model="options.updated_at_to"
                  type="datetime-local"
                  :label="$t('updated_at_to')"
                  hide-details
                  @update:modelValue="resetToFirstPage"
                />
              </div>

              <div class="d-flex justify-end mt-4">
                <VBtn
                  color="secondary"
                  variant="tonal"
                  prepend-icon="tabler-x"
                  @click="clearAdvancedFilters"
                >
                  {{ $t('clear_filters') }}
                </VBtn>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>

        <VDataTable
          class="warm-channels-table"
          :headers="headers"
          :items="warmChannelsStore.list"
          :loading="warmChannelsStore.loading"
          :items-per-page="options.itemsPerPage"
          :page="options.page"
          :server-items-length="warmChannelsStore.pagings.total"
          @update:options="handleTableChange"
        >
          <template #item.warm_pool_id="{ item }">
            <span class="mono-value">{{ item.warm_pool_id }}</span>
          </template>

          <template #item.server="{ item }">
            <span>{{ item.server?.name ?? '-' }}</span>
          </template>

          <template #item.type="{ item }">
            <VChip
              :color="resolveTypeVariant(item.type?.id).color"
              size="small"
            >
              {{ resolveTypeVariant(item.type?.id).text }}
            </VChip>
          </template>

          <template #item.state="{ item }">
            <VChip :color="resolveStateVariant(item.state).color" size="small">
              {{ resolveStateVariant(item.state).text }}
            </VChip>
          </template>

          <template #item.container_id="{ item }">
            <span class="mono-value">{{ item.container_id ?? '-' }}</span>
          </template>

          <template #item.container_name="{ item }">
            <span class="mono-value">{{ item.container_name ?? '-' }}</span>
          </template>

          <template #item.session_volume_name="{ item }">
            <span class="mono-value">{{ item.session_volume_name }}</span>
          </template>

          <template #item.last_health_at="{ item }">
            <span>
              {{ item.last_health_at ? formatDateTime(item.last_health_at) : '-' }}
            </span>
          </template>

          <template #item.updated_at="{ item }">
            <span>{{ item.updated_at ? formatDateTime(item.updated_at) : '-' }}</span>
          </template>

          <template #item.created_at="{ item }">
            <span>{{ item.created_at ? formatDateTime(item.created_at) : '-' }}</span>
          </template>

          <template #item.actions="{ item }">
            <IconBtn @click="recreateWarmChannel(item.warm_pool_id)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('recreate') }}</span>
              </VTooltip>
              <VIcon icon="tabler-refresh" />
            </IconBtn>
          </template>

          <template #bottom>
            <TablePagination
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="warmChannelsStore.pagings.total"
            />
          </template>
        </VDataTable>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="warmChannelsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="warmChannelsStore.snackbar.color"
    >
      {{ warmChannelsStore.snackbar.message }}
    </VSnackbar>

    <VDialogHandler
      v-model="isDialogRecreatorShow"
      :title="$t('recreate') + ' ' + $t('warm_channel')"
      :message="$t('recreate_warm_channel_confirmation')"
      @confirm="handleRecreate"
    />

    <VDialogHandler
      v-model="isDialogRecreateAllShow"
      :title="$t('recreate_all')"
      :message="$t('recreate_all_warm_channels_confirmation')"
      @confirm="handleRecreateAll"
    />
  </div>
</template>

<style scoped>
.warm-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.warm-summary__metric {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-block-size: 56px;
}

.filters-grid {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) 120px minmax(240px, 1.5fr);
  gap: 1rem;
  align-items: end;
}

.filter-field {
  min-inline-size: 0;
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(160px, 1fr));
  gap: 1rem;
}

.mono-value {
  display: inline-block;
  max-inline-size: 18rem;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.warm-channels-table {
  min-inline-size: 100%;
}

@media (max-width: 1260px) {
  .filters-grid {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }

  .advanced-grid {
    grid-template-columns: repeat(2, minmax(160px, 1fr));
  }
}

@media (max-width: 720px) {
  .warm-summary {
    align-items: stretch;
    flex-direction: column;
  }

  .filters-grid,
  .advanced-grid {
    grid-template-columns: 1fr;
  }
}
</style>
