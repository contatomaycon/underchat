<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EContactGroupPermissions } from '@core/common/enums/EPermissions/contactGroup';
import { ListContactGroupResponse } from '@core/schema/contactGroup/listContactGroup/response.schema';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import AppAddContactGroup from '@/components/contactGroup/AppAddContactGroup.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EContactGroupPermissions.contact_group_assignment_group,
      EContactGroupPermissions.contact_group_view,
      EContactGroupPermissions.contact_group_create,
      EContactGroupPermissions.contact_group_update,
      EContactGroupPermissions.contact_group_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EContactGroupPermissions.contact_group_assignment_group,
  EContactGroupPermissions.contact_group_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EContactGroupPermissions.contact_group_assignment_group,
  EContactGroupPermissions.contact_group_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EContactGroupPermissions.contact_group_assignment_group,
  EContactGroupPermissions.contact_group_create,
];

const { t } = useI18n();
const contactGroupStore = useContactGroupStore();
useSnackbarCleanup(contactGroupStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const contactGroupToDelete = ref<string | null>(null);

const isDialogEditContactGroupShow = ref(false);
const isAddContactGroupVisible = ref(false);
const contactGroupToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListContactGroupResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('description'), key: 'description' },
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

const deleteContactGroup = async (id: string) => {
  contactGroupToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!contactGroupToDelete.value) return;

  const result = await contactGroupStore.deleteContactGroup(
    contactGroupToDelete.value
  );
  if (result) {
    await contactGroupStore.listContactGroup(query.value);
  }

  contactGroupToDelete.value = null;
};

const openEditDialog = (id: string) => {
  contactGroupToEdit.value = id;

  isDialogEditContactGroupShow.value = true;
};

watch(
  query,
  async (q) => {
    await contactGroupStore.listContactGroup(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('contact_groups')" no-padding>
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
              @click="isAddContactGroupVisible = true"
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
      </VCardText>

      <VDivider class="my-4" />

      <VDataTableServer
        class="data-table"
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        :headers="headers"
        :items="contactGroupStore.list"
        :items-length="contactGroupStore.pagings.total"
        :loading="contactGroupStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.name="{ item }">
          {{ item?.name }}
        </template>

        <template #item.description="{ item }">
          {{ item?.description }}
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="$canPermission(permissionsEdit) && item?.contact_group_id"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('add_or_delete_contact_group') }}</span> </VTooltip
              ><VIcon
                icon="tabler-square-rounded-plus"
                @click="openEditDialog(item.contact_group_id)"
            /></IconBtn>

            <IconBtn
              v-if="$canPermission(permissionsDelete) && item.contact_group_id"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_contact_group') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteContactGroup(item.contact_group_id)"
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
            :total-items="contactGroupStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_contact_group')"
        :message="$t('delete_contact_group_confirmation')"
        @confirm="handleDelete"
      />

      <AppAddOrDellContactGroup
        v-if="isDialogEditContactGroupShow"
        v-model="isDialogEditContactGroupShow"
        :contact-group-id="contactGroupToEdit"
      />

      <AppAddContactGroup
        v-if="isAddContactGroupVisible"
        v-model="isAddContactGroupVisible"
      />
    </VCard>

    <VSnackbar
      v-model="contactGroupStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="contactGroupStore.snackbar.color"
    >
      {{ contactGroupStore.snackbar.message }}
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
