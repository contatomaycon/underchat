<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { useI18n } from 'vue-i18n';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { DataTableHeader } from 'vuetify';
import { ListIntegrationsItem } from '@core/schema/integration/listIntegrations/response.schema';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import AppAddEditIntegration from '@/components/integration/AppAddEditIntegration.vue';
import AppIntegrationConfig from '@/components/integration/AppIntegrationConfig.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import TablePagination from '@/@webcore/components/TablePagination.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EIntegrationPermissions.integration_group,
    ],
  },
});

const { t } = useI18n();
const integrationStore = useIntegrationStore();
useSnackbarCleanup(integrationStore);

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: '', text: t('all') },
  { id: EStatusApiKey.active, text: t('integration_status_active') },
  { id: EStatusApiKey.inactive, text: t('integration_status_inactive') },
]);

const headers: DataTableHeader<ListIntegrationsItem>[] = [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('channel'), key: 'worker_name' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  search: null as string | null,
  status: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const isAddEditModalOpen = ref(false);
const integrationToEdit = ref<string | null>(null);
const isConfigModalOpen = ref(false);
const integrationToConfig = ref<string | null>(null);
const isDeleteDialogOpen = ref(false);
const integrationToDelete = ref<string | null>(null);

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  search: debouncedSearch.value || undefined,
  status: options.value.status || undefined,
}));

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const openAddDialog = () => {
  integrationToEdit.value = null;
  isAddEditModalOpen.value = true;
};

const openEditDialog = (apiKeyId: string) => {
  integrationToEdit.value = apiKeyId;
  isAddEditModalOpen.value = true;
};

const openConfigDialog = (apiKeyId: string) => {
  integrationToConfig.value = apiKeyId;
  isConfigModalOpen.value = true;
};

const openDeleteDialog = (apiKeyId: string) => {
  integrationToDelete.value = apiKeyId;
  isDeleteDialogOpen.value = true;
};

const handleDelete = async () => {
  if (!integrationToDelete.value) {
    return;
  }

  await integrationStore.deleteIntegration(integrationToDelete.value);
  integrationToDelete.value = null;
  isDeleteDialogOpen.value = false;
};

const handleIntegrationCreated = () => {
  isAddEditModalOpen.value = false;
  integrationToEdit.value = null;
};

const handleIntegrationUpdated = () => {
  isAddEditModalOpen.value = false;
  integrationToEdit.value = null;
};

const handleConfigClosed = () => {
  isConfigModalOpen.value = false;
  integrationToConfig.value = null;
};

watch(
  query,
  async (q) => {
    await integrationStore.listIntegrations(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('integration')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center mt-5">
            <div class="d-flex align-center gap-x-2">
              <div>{{ $t('show') }}</div>
              <AppSelect
                :model-value="options.itemsPerPage"
                :items="itemsPerPage"
                @update:model-value="
                  options.itemsPerPage = parseInt($event, 10)
                "
              />
            </div>

            <VBtn
              v-if="$canPermission(permissionsCreate)"
              prepend-icon="tabler-plus"
              @click="openAddDialog"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
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

        <div>
          <VDataTableServer
            class="data-table"
            v-model:page="options.page"
            v-model:items-per-page="options.itemsPerPage"
            :headers="headers"
            :items="integrationStore.integrations"
            :items-length="integrationStore.pagings.total"
            :loading="integrationStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.name="{ item }">
              <div class="d-flex flex-column ms-3">
                <span
                  class="d-block font-weight-medium text-high-emphasis text-truncate"
                >
                  {{ item.name }}
                </span>
              </div>
            </template>

            <template #item.status="{ item }">
              <VChip
                :color="
                  item.status === EStatusApiKey.active ? 'success' : 'error'
                "
                variant="tonal"
                size="small"
              >
                {{
                  item.status === EStatusApiKey.active
                    ? $t('integration_status_active')
                    : $t('integration_status_inactive')
                }}
              </VChip>
            </template>

            <template #item.worker_name="{ item }">
              <span v-if="item.worker_name" class="text-medium-emphasis">
                {{ item.worker_name }}
              </span>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn v-if="$canPermission(permissionsEdit)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('configure') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-settings"
                    @click="openConfigDialog(item.api_key_id)"
                  />
                </IconBtn>

                <IconBtn v-if="$canPermission(permissionsEdit)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{
                      item.status === EStatusApiKey.active
                        ? $t('deactivate')
                        : $t('activate')
                    }}</span>
                  </VTooltip>
                  <VIcon
                    :icon="
                      item.status === EStatusApiKey.active
                        ? 'tabler-toggle-left'
                        : 'tabler-toggle-right'
                    "
                    @click="
                      integrationStore.updateIntegrationStatus(
                        item.api_key_id,
                        item.status === EStatusApiKey.active
                          ? EStatusApiKey.inactive
                          : EStatusApiKey.active
                      )
                    "
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
                    @click="openEditDialog(item.api_key_id)"
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
                    @click="openDeleteDialog(item.api_key_id)"
                  />
                </IconBtn>
              </div>
            </template>

            <template #no-data>
              {{ $t('no_data_available') }}
            </template>

            <template #bottom>
              <TablePagination
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="integrationStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>

      <VDialogHandler
        v-if="isDeleteDialogOpen"
        v-model="isDeleteDialogOpen"
        :title="$t('delete_integration')"
        :message="$t('delete_integration_confirmation')"
        @confirm="handleDelete"
      />

      <AppAddEditIntegration
        v-if="isAddEditModalOpen"
        v-model="isAddEditModalOpen"
        :api-key-id="integrationToEdit"
        @created="handleIntegrationCreated"
        @updated="handleIntegrationUpdated"
      />

      <AppIntegrationConfig
        v-if="isConfigModalOpen"
        v-model="isConfigModalOpen"
        :api-key-id="integrationToConfig"
        @closed="handleConfigClosed"
      />
    </VCard>

    <VSnackbar
      v-model="integrationStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="integrationStore.snackbar.color"
    >
      {{ integrationStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}

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

<route lang="json">
{
  "name": "integration"
}
</route>
