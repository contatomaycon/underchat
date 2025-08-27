<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';
import { useUsersStore } from '@/@webcore/stores/user';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { EUserStatus } from '@core/common/enums/EUserStatus';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EUserPermissions.user_list,
      EUserPermissions.user_view,
      EUserPermissions.user_create,
      EUserPermissions.user_update,
      EUserPermissions.user_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_create,
];

const { t } = useI18n();
const userStore = useUsersStore();

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
  { id: EUserStatus.active, text: t('active') },
  { id: EUserStatus.inactive, text: t('inactive') },
  { id: EUserStatus.blocked, text: t('blocked') },
]);

const isDialogDeleterShow = ref(false);
const userToDelete = ref<string | null>(null);

const isDialogEditUserShow = ref(false);
const isAddUserVisible = ref(false);
const userToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListUserResponse>[] = [
  { title: t('username'), key: 'username' },
  { title: t('account'), key: 'account' },
  { title: t('status'), key: 'status' },
  { title: t('email_partial'), key: 'email_partial' },
  { title: t('phone_partial'), key: 'phone_partial' },
  { title: t('document_partial'), key: 'document_partial' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  user_status: null as string | null,
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
  user_status: options.value.user_status,
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

const deleteUser = async (id: string) => {
  userToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!userToDelete.value) return;

  const result = await userStore.deleteUser(userToDelete.value);
  if (result) {
    await userStore.listUsers(query.value);
  }

  userToDelete.value = null;
};

const openEditDialog = (id: string) => {
  userToEdit.value = id;

  isDialogEditUserShow.value = true;
};

watch(
  query,
  async (q) => {
    await userStore.listUsers(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('users')" no-padding>
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
              @click="isAddUserVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel>{{ $t('status') }}:</VLabel>
              <AppAutocomplete
                item-title="text"
                item-value="id"
                :items="itemsStatus"
                v-model="options.user_status"
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
        :items="userStore.list"
        :items-length="userStore.pagings.total"
        :loading="userStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.name="{ item }">
          <div class="d-flex flex-column ms-3">
            <span
              class="d-block font-weight-medium text-high-emphasis text-truncate"
            >
              {{ item.username }}
            </span>
          </div>
        </template>

        <template #item.account="{ item }">
          {{ item.account?.name }}
        </template>

        <template #item.status="{ item }">
          {{ $t(`${item.user_status?.name}`) }}
        </template>

        <template #item.phone_partial="{ item }">
          {{ $t(`${item.user_info?.phone_partial}`) }}
        </template>

        <template #item.document_partial="{ item }">
          {{ $t(`${item.user_document?.document_partial}`) }}
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn v-if="$canPermission(permissionsEdit)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_user') }}</span> </VTooltip
              ><VIcon icon="tabler-edit" @click="openEditDialog(item.user_id)"
            /></IconBtn>

            <IconBtn v-if="$canPermission(permissionsDelete)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_user') }}</span> </VTooltip
              ><VIcon icon="tabler-trash" @click="deleteUser(item.user_id)"
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
            :total-items="userStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_user')"
        :message="$t('delete_user_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditUser
        v-if="isDialogEditUserShow"
        v-model="isDialogEditUserShow"
        :user-id="userToEdit"
      />

      <AppAddUser v-if="isAddUserVisible" v-model="isAddUserVisible" />
    </VCard>

    <VSnackbar
      v-model="userStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="userStore.snackbar.color"
    >
      {{ userStore.snackbar.message }}
    </VSnackbar>
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
