<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { useAccountStore } from '@/@webcore/stores/account';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
      EAccountPermissions.account_view,
    ],
  },
});

const { t } = useI18n();
const accountStore = useAccountStore();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { value: null, title: t('all') },
  { value: EAccountStatus.active, title: t('active') },
  { value: EAccountStatus.inactive, title: t('inactive') },
  { value: EAccountStatus.blocked, title: t('blocked') },
]);

const headers: DataTableHeader<ListAccountResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('account_status'), key: 'account_status' },
  { title: t('plan'), key: 'plan' },
  { title: t('created_at'), key: 'created_at' },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  account_status: null as string | null,
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
  account_status: options.value.account_status,
  name: debouncedSearch.value,
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

const totalClients = computed(() => accountStore.pagings.total);
const activeClients = computed(() => {
  return accountStore.list.filter(
    (account) =>
      account.account_status?.account_status_id === EAccountStatus.active
  ).length;
});
const inactiveClients = computed(() => {
  return accountStore.list.filter(
    (account) =>
      account.account_status?.account_status_id === EAccountStatus.inactive
  ).length;
});
const blockedClients = computed(() => {
  return accountStore.list.filter(
    (account) =>
      account.account_status?.account_status_id === EAccountStatus.blocked
  ).length;
});

const resolveStatusText = (statusId?: string | null) => {
  if (!statusId) {
    return '-';
  }

  if (statusId === EAccountStatus.active) {
    return t('active');
  } else if (statusId === EAccountStatus.inactive) {
    return t('inactive');
  } else if (statusId === EAccountStatus.blocked) {
    return t('blocked');
  }

  return '-';
};

const resolvePlanVariant = (planName?: string | null) => {
  if (!planName) {
    return { color: 'primary', text: t('unknown') };
  }

  switch (planName.toLowerCase()) {
    case 'ouro':
      return { color: 'warning', text: t('ouro') };
    case 'diamante':
      return { color: 'info', text: t('diamante') };
    case 'prata':
      return { color: 'secondary', text: t('prata') };
    case 'bronze':
      return { color: 'error', text: t('bronze') };
    default:
      return { color: 'primary', text: planName };
  }
};

watch(
  query,
  async (q) => {
    await accountStore.listAccount(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('clients_report')" no-padding>
      <VCardText>
        <!-- Cards de Estatísticas -->
        <div class="d-flex gap-4 flex-wrap mb-6">
          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('total_clients') }}
                  </div>
                  <div class="text-h5 text-primary font-weight-bold">
                    {{ totalClients }}
                  </div>
                </div>
                <VIcon icon="tabler-users" size="40" color="primary" />
              </div>
            </VCardText>
          </VCard>

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('active_clients') }}
                  </div>
                  <div class="text-h5 text-success font-weight-bold">
                    {{ activeClients }}
                  </div>
                </div>
                <VIcon icon="tabler-user-check" size="40" color="success" />
              </div>
            </VCardText>
          </VCard>

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('inactive_clients') }}
                  </div>
                  <div class="text-h5 text-error font-weight-bold">
                    {{ inactiveClients }}
                  </div>
                </div>
                <VIcon icon="tabler-user-x" size="40" color="error" />
              </div>
            </VCardText>
          </VCard>

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('blocked_clients') }}
                  </div>
                  <div class="text-h5 text-error font-weight-bold">
                    {{ blockedClients }}
                  </div>
                </div>
                <VIcon icon="tabler-user-off" size="40" color="error" />
              </div>
            </VCardText>
          </VCard>
        </div>

        <!-- Filtros -->
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
            <div class="status-filter">
              <VLabel>{{ $t('status') }}:</VLabel>
              <AppSelect
                v-model="options.account_status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('search') }}:</VLabel>
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
      </VCardText>

      <VDataTableServer
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
          {{ resolveStatusText(item.account_status?.account_status_id) }}
        </template>

        <template #item.plan="{ item }">
          <VChip
            v-if="item.plan"
            :color="resolvePlanVariant(item.plan?.name).color"
            size="small"
          >
            {{ resolvePlanVariant(item.plan?.name).text }}
          </VChip>
          <span v-else>-</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
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
    </VCard>
  </div>
</template>

<style lang="scss">
.status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
