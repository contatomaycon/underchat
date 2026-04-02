<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { useAccountStore } from '@/@webcore/stores/account';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { EColor } from '@core/common/enums/EColor';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import AppAccountExclusivePlans from '@/components/account/AppAccountExclusivePlans.vue';
import AppAccountInvoices from '@/components/account/AppAccountInvoices.vue';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';
import { useRoute } from 'vue-router';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
    ],
  },
});

const permissionsAccount = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
];

const { t } = useI18n();
const route = useRoute();
const accountStore = useAccountStore();
const accountSettingsStore = useAccountSettingsStore();
useSnackbarCleanup(accountStore);
useSnackbarCleanup(accountSettingsStore);

const getRouteQueryValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return null;
};

const parseSearchQuery = (value: unknown): string | null => {
  const queryValue = getRouteQueryValue(value);

  if (!queryValue) {
    return null;
  }

  const trimmed = queryValue.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseAccountIdQuery = (value: unknown): string | null => {
  const queryValue = getRouteQueryValue(value);

  if (!queryValue) {
    return null;
  }

  const trimmed = queryValue.trim();
  return trimmed || null;
};

const parseFilterStatusQuery = (value: unknown): EAccountFilterStatus => {
  const queryValue = getRouteQueryValue(value);

  if (!queryValue) {
    return EAccountFilterStatus.subscribers;
  }

  const isValid = Object.values(EAccountFilterStatus).includes(
    queryValue as EAccountFilterStatus
  );

  return isValid
    ? (queryValue as EAccountFilterStatus)
    : EAccountFilterStatus.subscribers;
};

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { value: EAccountFilterStatus.all, title: t('all') },
  { value: EAccountFilterStatus.subscribers, title: t('subscribers') },
  { value: EAccountFilterStatus.cancelling, title: t('cancelling') },
  { value: EAccountFilterStatus.cancelled, title: t('cancelled') },
  { value: EAccountFilterStatus.blocked, title: t('blocked') },
  { value: EAccountFilterStatus.expired, title: t('expired') },
  { value: EAccountFilterStatus.tests, title: t('tests') },
  { value: EAccountFilterStatus.deleted, title: t('deleted') },
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

const getAccountStatusColor = (statusId: string) => {
  if (statusId === EAccountStatus.active) return 'success';
  if (statusId === EAccountStatus.blocked) return 'error';
  if (statusId === EAccountStatus.inactive) return 'warning';
  return 'secondary';
};

const getAccountStatusLabel = (status: {
  account_status_id: string;
  name: string;
}) => {
  if (status.account_status_id === EAccountStatus.active) return t('active');
  if (status.account_status_id === EAccountStatus.blocked) return t('blocked');
  if (status.account_status_id === EAccountStatus.inactive) return t('inactive');
  return status.name;
};

const isDialogDeleterShow = ref(false);
const accountToDelete = ref<string | null>(null);

const isDialogBlockShow = ref(false);
const accountToBlock = ref<string | null>(null);

const isDialogUnblockShow = ref(false);
const accountToUnblock = ref<string | null>(null);

const isDialogEditAccountShow = ref(false);
const isAddAccountVisible = ref(false);
const accountToEdit = ref<string | null>(null);
const accountInfo = ref<string | null>(null);
const isDialogAccountInfoShow = ref(false);
const accountSubscriptions = ref<string | null>(null);
const isDialogAccountSubscriptionsShow = ref(false);
const accountExclusivePlans = ref<string | null>(null);
const isDialogAccountExclusivePlansShow = ref(false);
const accountInvoices = ref<string | null>(null);
const isDialogAccountInvoicesShow = ref(false);

const headers: DataTableHeader<ListAccountResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('account_status'), key: 'account_status' },
  { title: t('plan'), key: 'plan' },
  { title: t('recurring_payment'), key: 'recurring_payment' },
  { title: t('billing_period'), key: 'billing_period' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  accountId: parseAccountIdQuery(route.query.account_id),
  search: parseSearchQuery(route.query.search),
  filterStatus: parseFilterStatusQuery(route.query.filter_status),
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  account_id: options.value.accountId,
  search: debouncedSearch.value,
  filter_status: options.value.filterStatus,
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

const deleteAccount = async (id: string) => {
  accountToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!accountToDelete.value) return;

  const result = await accountStore.deleteAccount(accountToDelete.value);
  if (result) {
    await accountStore.listAllAccountsWithDetails(query.value);
  }

  accountToDelete.value = null;
};

const blockAccount = (id: string) => {
  accountToBlock.value = id;
  isDialogBlockShow.value = true;
};

const handleBlock = async () => {
  if (!accountToBlock.value) return;

  const result = await accountStore.blockAccount(accountToBlock.value);
  if (result) {
    await accountStore.listAllAccountsWithDetails(query.value);
  }

  accountToBlock.value = null;
};

const unblockAccount = (id: string) => {
  accountToUnblock.value = id;
  isDialogUnblockShow.value = true;
};

const handleUnblock = async () => {
  if (!accountToUnblock.value) return;

  const result = await accountStore.unblockAccount(accountToUnblock.value);
  if (result) {
    await accountStore.listAllAccountsWithDetails(query.value);
  }

  accountToUnblock.value = null;
};

const openEditDialog = (id: string) => {
  accountToEdit.value = id;

  isDialogEditAccountShow.value = true;
};

const openAddRoleDialog = (id: string) => {
  accountInfo.value = id;

  isDialogAccountInfoShow.value = true;
};

const openSubscriptionsDialog = (id: string) => {
  accountSubscriptions.value = id;

  isDialogAccountSubscriptionsShow.value = true;
};

const openExclusivePlansDialog = (id: string) => {
  accountExclusivePlans.value = id;

  isDialogAccountExclusivePlansShow.value = true;
};

const openInvoicesDialog = (id: string) => {
  accountInvoices.value = id;

  isDialogAccountInvoicesShow.value = true;
};

watch(
  query,
  async (q) => {
    await accountStore.listAllAccountsWithDetails(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('accounts')" no-padding>
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
              v-if="$canPermission(permissionsAccount)"
              prepend-icon="tabler-plus"
              @click="isAddAccountVisible = true"
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
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('account_status') }}:</VLabel
              >
              <AppSelect
                :model-value="options.filterStatus"
                :items="itemsStatus"
                @update:model-value="options.filterStatus = $event"
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
            item-value="account_id"
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
              <div
                v-if="(item.account_statuses?.length ?? 0) > 0"
                class="d-flex flex-wrap gap-1"
              >
                <VChip
                  v-for="status in item.account_statuses"
                  :key="`${item.account_id}-${status.account_status_id}`"
                  :color="getAccountStatusColor(status.account_status_id)"
                  size="small"
                  variant="tonal"
                >
                  {{ getAccountStatusLabel(status) }}
                </VChip>
              </div>
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

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn v-if="$canPermission(permissionsAccount)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('account_info') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-settings"
                    @click="openAddRoleDialog(item.account_id)"
                /></IconBtn>

                <IconBtn
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('plan') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-credit-card"
                    @click="openSubscriptionsDialog(item.account_id)"
                /></IconBtn>

                <IconBtn
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('exclusive_plans') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-star"
                    @click="openExclusivePlansDialog(item.account_id)"
                /></IconBtn>

                <IconBtn
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('invoices') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-receipt-2"
                    @click="openInvoicesDialog(item.account_id)"
                /></IconBtn>

                <IconBtn
                  v-if="$canPermission(permissionsAccount) && item?.account_id"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_account') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-edit"
                    @click="openEditDialog(item.account_id)"
                /></IconBtn>

                <IconBtn
                  v-if="
                    $canPermission(permissionsAccount) &&
                    item.account_id &&
                    item.account_status?.account_status_id !==
                      EAccountStatus.blocked
                  "
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('block') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-lock"
                    @click="blockAccount(item.account_id)"
                /></IconBtn>

                <IconBtn
                  v-if="
                    $canPermission(permissionsAccount) &&
                    item.account_id &&
                    item.account_status?.account_status_id ===
                      EAccountStatus.blocked
                  "
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('unblock') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-lock-open"
                    @click="unblockAccount(item.account_id)"
                /></IconBtn>

                <IconBtn
                  v-if="$canPermission(permissionsAccount) && item.account_id"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_account') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-trash"
                    @click="deleteAccount(item.account_id)"
                /></IconBtn>
              </div>
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

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_account')"
        :message="$t('delete_account_confirmation')"
        @confirm="handleDelete"
      />

      <VDialogHandler
        v-if="isDialogBlockShow"
        v-model="isDialogBlockShow"
        :title="$t('block_account')"
        :message="$t('block_account_confirmation')"
        @confirm="handleBlock"
      />

      <VDialogHandler
        v-if="isDialogUnblockShow"
        v-model="isDialogUnblockShow"
        :title="$t('unblock_account')"
        :message="$t('unblock_account_confirmation')"
        @confirm="handleUnblock"
      />

      <AppEditAccount
        v-if="isDialogEditAccountShow"
        v-model="isDialogEditAccountShow"
        :account-id="accountToEdit"
      />

      <AppAccountInfo
        v-if="isDialogAccountInfoShow"
        v-model="isDialogAccountInfoShow"
        :account-id="accountInfo"
      />

      <AppAccountSubscriptions
        v-if="isDialogAccountSubscriptionsShow"
        v-model="isDialogAccountSubscriptionsShow"
        :account-id="accountSubscriptions"
      />

      <AppAccountExclusivePlans
        v-if="isDialogAccountExclusivePlansShow"
        v-model="isDialogAccountExclusivePlansShow"
        :account-id="accountExclusivePlans"
      />

      <AppAccountInvoices
        v-if="isDialogAccountInvoicesShow && accountInvoices"
        v-model="isDialogAccountInvoicesShow"
        :account-id="accountInvoices"
      />

      <AppAddAccount v-if="isAddAccountVisible" v-model="isAddAccountVisible" />
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
