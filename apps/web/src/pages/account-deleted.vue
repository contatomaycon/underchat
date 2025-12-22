<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { useAccountStore } from '@/@webcore/stores/account';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { EColor } from '@core/common/enums/EColor';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
      EAccountPermissions.account_view,
      EAccountPermissions.account_create,
      EAccountPermissions.account_update,
      EAccountPermissions.account_delete,
    ],
  },
});

const { t } = useI18n();
const accountStore = useAccountStore();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(accountStore);
useSnackbarCleanup(accountSettingsStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const resolvePlanVariant = (planName?: string | null) => {
  if (!planName) {
    return { color: EColor.primary, text: t('unknown') };
  }

  switch (planName.toLowerCase()) {
    case 'ouro':
      return { color: EColor.warning, text: t('ouro') };
    case 'diamante':
      return { color: EColor.info, text: t('diamante') };
    case 'prata':
      return { color: EColor.secondary, text: t('prata') };
    case 'bronze':
      return { color: EColor.error, text: t('bronze') };
    default:
      return { color: EColor.primary, text: planName };
  }
};

const headers: DataTableHeader<ListAccountResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('account_status'), key: 'account_status' },
  { title: t('plan'), key: 'plan' },
  { title: t('recurring_payment'), key: 'recurring_payment' },
  { title: t('billing_period'), key: 'billing_period' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('deleted_at'), key: 'deleted_at' },
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

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  search: debouncedSearch.value,
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

watch(
  query,
  async (q) => {
    await accountStore.listAccountDeleted(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('deleted')" no-padding>
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

        <div>
          <VDataTableServer
            class="data-table"
            v-model:page="options.page"
            v-model:items-per-page="options.itemsPerPage"
            :headers="headers"
            :items="accountStore.list"
            :items-length="accountStore.pagings.total"
            :loading="accountStore.loading"
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

            <template #item.account_status="{ item }">
              <VChip
                v-if="item.account_status"
                :color="
                  item.account_status.account_status_id ===
                  EAccountStatus.active
                    ? 'success'
                    : item.account_status.account_status_id ===
                        EAccountStatus.blocked
                      ? 'error'
                      : 'warning'
                "
                size="small"
                variant="tonal"
              >
                {{
                  item.account_status.account_status_id ===
                  EAccountStatus.active
                    ? $t('active')
                    : item.account_status.account_status_id ===
                        EAccountStatus.blocked
                      ? $t('blocked')
                      : $t('inactive')
                }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.plan="{ item }">
              <VChip
                v-if="item.plan"
                :color="resolvePlanVariant(item.plan?.name).color"
                class="uc-chip"
                size="small"
              >
                {{ resolvePlanVariant(item.plan?.name).text }}
              </VChip>

              <VChip v-else class="uc-chip uc-badge--muted" size="small"
                >-</VChip
              >
            </template>

            <template #item.recurring_payment="{ item }">
              <VChip
                v-if="item.plan"
                :color="item.plan.recurring_payment ? 'success' : 'warning'"
                size="small"
                variant="tonal"
              >
                {{ item.plan.recurring_payment ? $t('yes') : $t('no') }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.billing_period="{ item }">
              <VChip
                v-if="item.plan?.billing_period"
                :color="
                  item.plan.billing_period === 'monthly' ? 'primary' : 'info'
                "
                size="small"
                variant="tonal"
              >
                {{
                  item.plan.billing_period === 'monthly'
                    ? $t('monthly')
                    : $t('annual')
                }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
            </template>

            <template #item.deleted_at="{ item }">
              <span>{{
                formatDateTime((item as any)?.deleted_at ?? null)
              }}</span>
            </template>

            <template #no-data>
              {{ $t('no_data_available') }}
            </template>

            <template #bottom>
              <TablePagination
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="accountStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="accountStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="accountStore.snackbar.color"
    >
      {{ accountStore.snackbar.message }}
    </VSnackbar>
    <VSnackbar
      v-model="accountSettingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="accountSettingsStore.snackbar.color"
    >
      {{ accountSettingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.invoice-list-filter {
  inline-size: 20rem;
}

.uc-chip {
  height: 24px;
  min-width: 88px;
  justify-content: center;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
