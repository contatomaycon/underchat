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

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAccountPermissions.account_group,
  EAccountPermissions.account_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAccountPermissions.account_group,
  EAccountPermissions.account_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAccountPermissions.account_group,
  EAccountPermissions.account_create,
];
const permissionsCustomize = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAccountPermissions.account_group,
  EAccountPermissions.account_customize,
];

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

const deleteAccount = async (id: string) => {
  accountToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!accountToDelete.value) return;

  const result = await accountStore.deleteAccount(accountToDelete.value);
  if (result) {
    await accountStore.listAccountCancelling(query.value);
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
    await accountStore.listAccountCancelling(query.value);
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
    await accountStore.listAccountCancelling(query.value);
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

watch(
  query,
  async (q) => {
    await accountStore.listAccountCancelling(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('cancelling')" no-padding>
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

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn v-if="$canPermission(permissionsCustomize)"
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
                  v-if="$canPermission(permissionsEdit) && item?.account_id"
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
                    $canPermission(permissionsEdit) &&
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
                    $canPermission(permissionsEdit) &&
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
                  v-if="$canPermission(permissionsDelete) && item.account_id"
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
