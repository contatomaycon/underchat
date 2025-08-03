<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { getAdministrator } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { ListRoleResponse } from '@core/schema/role/listRole/response.schema';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';
import { useRolesStore } from '@/@webcore/stores/role';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      ERolePermissions.role_list,
      ERolePermissions.role_view,
      ERolePermissions.role_create,
      ERolePermissions.role_edit,
      ERolePermissions.role_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_edit,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_create,
];

const { t } = useI18n();
const roleStore = useRolesStore();
const isAdministrator = getAdministrator();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const roleToDelete = ref<string | null>(null);

const isDialogEditRoleShow = ref(false);
const isAddRoleVisible = ref(false);
const roleToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListRoleResponse>[] = [
  { title: t('name'), key: 'name' },
  ...(isAdministrator ? [{ title: t('account'), key: 'account' }] : []),
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as string | null,
  type: null as string | null,
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

const deleteRole = async (id: string) => {
  roleToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!roleToDelete.value) return;

  const result = await roleStore.deleteRole(roleToDelete.value);
  if (result) {
    await roleStore.listRoles(query.value);
  }

  roleToDelete.value = null;
};

const openEditDialog = (id: string) => {
  roleToEdit.value = id;

  isDialogEditRoleShow.value = true;
};

watch(
  query,
  async (q) => {
    await roleStore.listRoles(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('cargos')" no-padding>
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
              @click="isAddRoleVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
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
        :items="roleStore.list"
        :items-length="roleStore.pagings.total"
        :loading="roleStore.loading"
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

        <template #item.account="{ item }">
          {{ item.account?.name }}
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                $canPermission(permissionsEdit) &&
                (item.account?.id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_channel') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.permission_role_id)"
            /></IconBtn>

            <IconBtn
              v-if="
                $canPermission(permissionsDelete) &&
                (item.account?.id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_role') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteRole(item.permission_role_id)"
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
            :total-items="roleStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_role')"
        :message="$t('delete_role_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditRole
        v-if="isDialogEditRoleShow"
        v-model="isDialogEditRoleShow"
        :role-id="roleToEdit"
      />

      <AppAddRole v-if="isAddRoleVisible" v-model="isAddRoleVisible" />
    </VCard>

    <VSnackbar
      v-model="roleStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="roleStore.snackbar.color"
    >
      {{ roleStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.status-filter {
  inline-size: 12rem;
}

.type-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
