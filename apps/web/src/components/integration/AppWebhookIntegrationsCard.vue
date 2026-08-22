<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import type { DataTableHeader } from 'vuetify';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import type { ListIntegrationsItem } from '@core/schema/integration/listIntegrations/response.schema';
import type { SortRequest } from '@core/schema/common/sortRequestSchema';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import AppAddEditIntegration from '@/components/integration/AppAddEditIntegration.vue';
import AppIntegrationConfig from '@/components/integration/AppIntegrationConfig.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import TablePagination from '@/@webcore/components/TablePagination.vue';

const { t } = useI18n();
const integrationStore = useIntegrationStore();

const permissionsManage = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];
const permissionsUpdateStatus = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_status_update,
];

const itemsPerPage = computed(() => [
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: t('all') },
]);

const statusItems = computed(() => [
  { id: '', text: t('all') },
  { id: EStatusApiKey.active, text: t('integration_status_active') },
  { id: EStatusApiKey.inactive, text: t('integration_status_inactive') },
]);

const headers = computed<DataTableHeader<ListIntegrationsItem>[]>(() => [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('channel'), key: 'worker_name' },
  { title: t('actions'), key: 'actions', sortable: false },
]);

const options = reactive({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  search: null as string | null,
  status: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.search),
  500
);
const query = computed(() => ({
  page: options.page,
  per_page: options.itemsPerPage,
  sort_by: options.sortBy,
  search: debouncedSearch.value || undefined,
  status: options.status || undefined,
}));

const isAddEditModalOpen = shallowRef(false);
const integrationToEdit = shallowRef<string | null>(null);
const isConfigModalOpen = shallowRef(false);
const integrationToConfig = shallowRef<string | null>(null);
const isDeleteDialogOpen = shallowRef(false);
const integrationToDelete = shallowRef<string | null>(null);

const handleTableChange = (tableOptions: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.page = tableOptions.page;
  options.itemsPerPage = tableOptions.itemsPerPage;
  options.sortBy = tableOptions.sortBy;
};

const resetPage = () => {
  options.page = 1;
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

const refreshCurrentPage = async () => {
  await integrationStore.listIntegrations(query.value);
};

const handleDelete = async () => {
  if (!integrationToDelete.value) return;

  const deleted = await integrationStore.deleteIntegration(
    integrationToDelete.value
  );
  integrationToDelete.value = null;
  isDeleteDialogOpen.value = false;

  if (deleted) await refreshCurrentPage();
};

const handleSaved = async () => {
  isAddEditModalOpen.value = false;
  integrationToEdit.value = null;
  await refreshCurrentPage();
};

const handleConfigClosed = async () => {
  isConfigModalOpen.value = false;
  integrationToConfig.value = null;
  await refreshCurrentPage();
};

const toggleStatus = async (item: ListIntegrationsItem) => {
  const nextStatus =
    item.status === EStatusApiKey.active
      ? EStatusApiKey.inactive
      : EStatusApiKey.active;
  const updated = await integrationStore.updateIntegrationStatus(
    item.api_key_id,
    nextStatus
  );

  if (updated) await refreshCurrentPage();
};

watch(
  query,
  async (currentQuery) => {
    await integrationStore.listIntegrations(currentQuery);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <VCard class="webhook-card" data-testid="webhook-integrations-card">
    <VCardText class="webhook-card__content">
      <div class="webhook-card__header">
        <div class="webhook-card__heading">
          <div class="webhook-card__icon" aria-hidden="true">
            <VIcon icon="tabler-webhook" size="25" />
          </div>
          <div>
            <div class="d-flex align-center flex-wrap gap-2 mb-1">
              <h2 class="webhook-card__title">
                {{ $t('webhook_integrations_title') }}
              </h2>
              <VChip size="small" color="info" variant="tonal">
                {{ $t('webhook_integrations_badge') }}
              </VChip>
            </div>
            <p class="webhook-card__subtitle">
              {{ $t('webhook_integrations_description') }}
            </p>
          </div>
        </div>

        <VBtn
          v-if="$canPermission(permissionsManage)"
          prepend-icon="tabler-plus"
          data-testid="new-webhook-button"
          @click="openAddDialog"
        >
          {{ $t('webhook_new') }}
        </VBtn>
      </div>

      <div
        class="webhook-flow mt-6"
        :aria-label="$t('webhook_flow_aria_label')"
      >
        <div class="webhook-flow__step">
          <span class="webhook-flow__number">1</span>
          <div>
            <strong>{{ $t('webhook_flow_create') }}</strong>
            <span>{{ $t('webhook_flow_create_hint') }}</span>
          </div>
        </div>
        <VIcon
          class="webhook-flow__arrow"
          icon="tabler-chevron-right"
          size="18"
        />
        <div class="webhook-flow__step">
          <span class="webhook-flow__number">2</span>
          <div>
            <strong>{{ $t('webhook_flow_sample') }}</strong>
            <span>{{ $t('webhook_flow_sample_hint') }}</span>
          </div>
        </div>
        <VIcon
          class="webhook-flow__arrow"
          icon="tabler-chevron-right"
          size="18"
        />
        <div class="webhook-flow__step">
          <span class="webhook-flow__number">3</span>
          <div>
            <strong>{{ $t('webhook_flow_map') }}</strong>
            <span>{{ $t('webhook_flow_map_hint') }}</span>
          </div>
        </div>
        <VIcon
          class="webhook-flow__arrow"
          icon="tabler-chevron-right"
          size="18"
        />
        <div class="webhook-flow__step">
          <span class="webhook-flow__number">4</span>
          <div>
            <strong>{{ $t('webhook_flow_activate') }}</strong>
            <span>{{ $t('webhook_flow_activate_hint') }}</span>
          </div>
        </div>
      </div>

      <div class="webhook-toolbar mt-6">
        <div class="webhook-toolbar__per-page">
          <span class="text-body-2 text-medium-emphasis">{{ $t('show') }}</span>
          <AppSelect
            :model-value="options.itemsPerPage"
            :items="itemsPerPage"
            hide-details
            @update:model-value="options.itemsPerPage = Number($event)"
          />
        </div>

        <div class="webhook-toolbar__filters">
          <AppSelectSearch
            v-model="options.status"
            class="webhook-toolbar__status"
            :items="statusItems"
            :placeholder="$t('select_state')"
            clearable
            hide-details
            item-value="id"
            item-title="text"
            prepend-inner-icon="tabler-adjustments-horizontal"
            @update:model-value="resetPage"
          />
          <AppTextField
            v-model="options.search"
            class="webhook-toolbar__search"
            :placeholder="$t('webhook_search_placeholder')"
            prepend-inner-icon="tabler-search"
            single-line
            hide-details
            @update:model-value="resetPage"
          />
        </div>
      </div>

      <VDivider class="my-5" />

      <VDataTableServer
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        class="webhook-table"
        :headers="headers"
        :items="integrationStore.integrations"
        :items-length="integrationStore.pagings.total"
        :loading="integrationStore.loading"
        :sort-by="options.sortBy"
        :loading-text="$t('loading_text')"
        @update:options="handleTableChange"
      >
        <template #item.name="{ item }">
          <div class="webhook-name-cell">
            <span class="webhook-name-cell__icon">
              <VIcon icon="tabler-plug-connected" size="18" />
            </span>
            <div class="min-w-0">
              <span
                class="d-block font-weight-medium text-high-emphasis text-truncate"
              >
                {{ item.name }}
              </span>
              <span class="text-caption text-medium-emphasis">
                {{ $t('webhook_inbound_label') }}
              </span>
            </div>
          </div>
        </template>

        <template #item.status="{ item }">
          <VChip
            :color="
              item.status === EStatusApiKey.active ? 'success' : 'secondary'
            "
            variant="tonal"
            size="small"
            :prepend-icon="
              item.status === EStatusApiKey.active
                ? 'tabler-circle-check'
                : 'tabler-circle-off'
            "
          >
            {{
              item.status === EStatusApiKey.active
                ? $t('integration_status_active')
                : $t('integration_status_inactive')
            }}
          </VChip>
        </template>

        <template #item.worker_name="{ item }">
          <div v-if="item.worker_name" class="d-flex align-center gap-2">
            <VIcon icon="tabler-brand-whatsapp" size="17" color="success" />
            <span class="text-medium-emphasis">{{ item.worker_name }}</span>
          </div>
          <span v-else class="text-medium-emphasis">—</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex align-center gap-1">
            <IconBtn
              v-if="$canPermission(permissionsManage)"
              :aria-label="$t('webhook_configure')"
              @click="openConfigDialog(item.api_key_id)"
            >
              <VIcon icon="tabler-settings" />
              <VTooltip location="top" activator="parent">
                {{ $t('webhook_configure') }}
              </VTooltip>
            </IconBtn>

            <IconBtn
              v-if="$canPermission(permissionsUpdateStatus)"
              :aria-label="
                item.status === EStatusApiKey.active
                  ? $t('deactivate')
                  : $t('activate')
              "
              @click="toggleStatus(item)"
            >
              <VIcon
                :icon="
                  item.status === EStatusApiKey.active
                    ? 'tabler-toggle-right'
                    : 'tabler-toggle-left'
                "
                :color="
                  item.status === EStatusApiKey.active ? 'success' : undefined
                "
              />
              <VTooltip location="top" activator="parent">
                {{
                  item.status === EStatusApiKey.active
                    ? $t('deactivate')
                    : $t('activate')
                }}
              </VTooltip>
            </IconBtn>

            <IconBtn
              v-if="$canPermission(permissionsManage)"
              :aria-label="$t('edit')"
              @click="openEditDialog(item.api_key_id)"
            >
              <VIcon icon="tabler-edit" />
              <VTooltip location="top" activator="parent">
                {{ $t('edit') }}
              </VTooltip>
            </IconBtn>

            <IconBtn
              v-if="$canPermission(permissionsManage)"
              :aria-label="$t('delete')"
              @click="openDeleteDialog(item.api_key_id)"
            >
              <VIcon icon="tabler-trash" />
              <VTooltip location="top" activator="parent">
                {{ $t('delete') }}
              </VTooltip>
            </IconBtn>
          </div>
        </template>

        <template #no-data>
          <div class="webhook-empty-state">
            <div class="webhook-empty-state__icon">
              <VIcon icon="tabler-webhook-off" size="30" />
            </div>
            <strong>{{ $t('webhook_empty_title') }}</strong>
            <span>{{ $t('webhook_empty_description') }}</span>
            <VBtn
              v-if="$canPermission(permissionsManage)"
              class="mt-2"
              size="small"
              variant="tonal"
              prepend-icon="tabler-plus"
              @click="openAddDialog"
            >
              {{ $t('webhook_new') }}
            </VBtn>
          </div>
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="integrationStore.pagings.total"
          />
        </template>
      </VDataTableServer>
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
      @created="handleSaved"
      @updated="handleSaved"
    />

    <AppIntegrationConfig
      v-if="isConfigModalOpen"
      v-model="isConfigModalOpen"
      :api-key-id="integrationToConfig"
      @closed="handleConfigClosed"
    />
  </VCard>
</template>

<style scoped lang="scss">
/* stylelint-disable selector-pseudo-class-no-unknown -- Vue scoped-style deep selector */
.webhook-card {
  border: 1px solid rgb(var(--v-theme-on-surface), 0.09);
  box-shadow: 0 10px 30px rgb(33, 58, 107, 5.5%);
}

.webhook-card__content {
  padding: 1.75rem;
}

.webhook-card__header,
.webhook-card__heading,
.webhook-toolbar,
.webhook-toolbar__per-page,
.webhook-toolbar__filters,
.webhook-name-cell {
  display: flex;
  align-items: center;
}

.webhook-card__header {
  justify-content: space-between;
  gap: 1.25rem;
}

.webhook-card__heading {
  gap: 1rem;
  min-inline-size: 0;
}

.webhook-card__icon {
  display: grid;
  flex: 0 0 auto;
  border: 1px solid rgb(var(--v-theme-info), 0.2);
  border-radius: 14px;
  background: rgb(var(--v-theme-info), 0.09);
  block-size: 3.1rem;
  color: rgb(var(--v-theme-info));
  inline-size: 3.1rem;
  place-items: center;
}

.webhook-card__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.18rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.webhook-card__subtitle {
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.65);
  font-size: 0.9rem;
  line-height: 1.55;
  max-inline-size: 58rem;
}

.webhook-flow {
  display: grid;
  align-items: center;
  padding: 1rem;
  border: 1px solid rgb(var(--v-theme-info), 0.13);
  border-radius: 14px;
  background:
    linear-gradient(90deg, rgb(var(--v-theme-info), 0.045), transparent),
    rgb(var(--v-theme-on-surface), 0.018);
  gap: 0.55rem;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(
      0,
      1fr
    ) auto minmax(0, 1fr);
}

.webhook-flow__step {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-inline-size: 0;
}

.webhook-flow__step > div {
  display: grid;
  gap: 0.08rem;
  min-inline-size: 0;
}

.webhook-flow__step strong {
  color: rgb(var(--v-theme-on-surface), 0.83);
  font-size: 0.8rem;
  font-weight: 650;
}

.webhook-flow__step span:not(.webhook-flow__number) {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webhook-flow__number {
  display: grid;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgb(var(--v-theme-info), 0.12);
  block-size: 1.8rem;
  color: rgb(var(--v-theme-info));
  font-size: 0.72rem;
  font-weight: 800;
  inline-size: 1.8rem;
  place-items: center;
}

.webhook-flow__arrow {
  color: rgb(var(--v-theme-on-surface), 0.27);
}

.webhook-toolbar {
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
}

.webhook-toolbar__per-page,
.webhook-toolbar__filters {
  gap: 0.75rem;
}

.webhook-toolbar__per-page :deep(.v-input) {
  inline-size: 5.5rem;
}

.webhook-toolbar__status {
  inline-size: 13rem;
}

.webhook-toolbar__search {
  inline-size: min(22rem, 32vw);
}

.webhook-table :deep(.v-table__wrapper > table > thead) {
  background: rgb(var(--v-theme-on-surface), 0.028);
}

.webhook-table :deep(.v-table__wrapper > table > thead > tr > th) {
  border-block-end: 1px solid rgb(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-on-surface), 0.65);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.045em;
  text-transform: uppercase;
}

.webhook-table :deep(.v-data-table__tr:hover > td) {
  background: rgb(var(--v-theme-primary), 0.025);
}

.webhook-name-cell {
  gap: 0.7rem;
  min-inline-size: 0;
  padding-inline-start: 0.25rem;
}

.webhook-name-cell__icon {
  display: grid;
  flex: 0 0 auto;
  border-radius: 9px;
  background: rgb(var(--v-theme-primary), 0.08);
  block-size: 2.15rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 2.15rem;
  place-items: center;
}

.webhook-empty-state {
  display: grid;
  color: rgb(var(--v-theme-on-surface), 0.56);
  gap: 0.3rem;
  padding-block: 2.75rem;
  padding-inline: 1rem;
  place-items: center;
}

.webhook-empty-state strong {
  color: rgb(var(--v-theme-on-surface), 0.8);
}

.webhook-empty-state__icon {
  display: grid;
  border-radius: 16px;
  background: rgb(var(--v-theme-info), 0.09);
  block-size: 3.4rem;
  color: rgb(var(--v-theme-info));
  inline-size: 3.4rem;
  margin-block-end: 0.35rem;
  place-items: center;
}

@media (max-width: 1100px) {
  .webhook-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .webhook-flow__arrow {
    display: none;
  }
}

@media (max-width: 699px) {
  .webhook-card__content {
    padding: 1.2rem;
  }

  .webhook-card__header,
  .webhook-card__heading {
    align-items: flex-start;
  }

  .webhook-card__header {
    flex-direction: column;
  }

  .webhook-card__header :deep(.v-btn) {
    inline-size: 100%;
  }

  .webhook-card__icon {
    block-size: 2.75rem;
    inline-size: 2.75rem;
  }

  .webhook-flow {
    grid-template-columns: 1fr;
  }

  .webhook-toolbar,
  .webhook-toolbar__filters {
    flex-direction: column;
    align-items: stretch;
  }

  .webhook-toolbar__filters,
  .webhook-toolbar__status,
  .webhook-toolbar__search {
    inline-size: 100%;
  }
}
/* stylelint-enable selector-pseudo-class-no-unknown */
</style>
