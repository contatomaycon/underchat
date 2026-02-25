<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { DataTableHeader } from 'vuetify';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ERandomMessagePermissions } from '@core/common/enums/EPermissions/randomMessage';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { ListRandomMessageResponse } from '@core/schema/randomMessage/listRandomMessage/response.schema';
import { useRandomMessageStore } from '@/@webcore/stores/randomMessage';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ERandomMessagePermissions.random_message_group,
      ERandomMessagePermissions.random_message_view,
      ERandomMessagePermissions.random_message_create,
      ERandomMessagePermissions.random_message_update,
      ERandomMessagePermissions.random_message_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_create,
];

const { t } = useI18n();
const router = useRouter();
const randomMessageStore = useRandomMessageStore();
useSnackbarCleanup(randomMessageStore);

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
  { id: ERandomMessageStatus.active, text: t('active') },
  { id: ERandomMessageStatus.inactive, text: t('inactive') },
]);

const isDialogDeleterShow = ref(false);
const randomMessageToDelete = ref<string | null>(null);

const isDialogEditRandomMessageShow = ref(false);
const isAddRandomMessageVisible = ref(false);
const randomMessageToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListRandomMessageResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as ERandomMessageStatus | null,
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
  status: options.value.status,
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

const deleteRandomMessage = async (id: string) => {
  randomMessageToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!randomMessageToDelete.value) return;

  const result = await randomMessageStore.deleteRandomMessage(
    randomMessageToDelete.value
  );

  if (result) {
    await randomMessageStore.listRandomMessages(query.value);
  }

  randomMessageToDelete.value = null;
};

const openEditDialog = (id: string) => {
  randomMessageToEdit.value = id;
  isDialogEditRandomMessageShow.value = true;
};

const openRandomMessageItems = (id: string) => {
  router.push(`/random-message/${id}/messages`);
};

watch(
  query,
  async (q) => {
    await randomMessageStore.listRandomMessages(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('random_messages')" no-padding>
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
              @click="isAddRandomMessageVisible = true"
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
            :items="randomMessageStore.list"
            :items-length="randomMessageStore.pagings.total"
            :loading="randomMessageStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.name="{ item }">
              <span
                class="d-inline-block text-truncate"
                style="max-width: 350px"
              >
                {{ item.name }}
              </span>
            </template>

            <template #item.status="{ item }">
              <VChip
                :color="
                  item.status === ERandomMessageStatus.active
                    ? 'success'
                    : 'error'
                "
                size="small"
                variant="tonal"
              >
                {{
                  item.status === ERandomMessageStatus.active
                    ? $t('active')
                    : $t('inactive')
                }}
              </VChip>
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn
                  v-if="
                    $canPermission(permissionsEdit) && item?.random_message_id
                  "
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('include_edit_messages') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-message-plus"
                    @click="openRandomMessageItems(item.random_message_id)"
                  />
                </IconBtn>

                <IconBtn
                  v-if="
                    $canPermission(permissionsEdit) && item?.random_message_id
                  "
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_random_message') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-edit"
                    @click="openEditDialog(item.random_message_id)"
                  />
                </IconBtn>

                <IconBtn
                  v-if="
                    $canPermission(permissionsDelete) && item.random_message_id
                  "
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_random_message') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-trash"
                    @click="deleteRandomMessage(item.random_message_id)"
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
                :total-items="randomMessageStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_random_message')"
        :message="$t('delete_random_message_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditRandomMessage
        v-if="isDialogEditRandomMessageShow"
        v-model="isDialogEditRandomMessageShow"
        :random-message-id="randomMessageToEdit"
      />

      <AppAddRandomMessage
        v-if="isAddRandomMessageVisible"
        v-model="isAddRandomMessageVisible"
      />
    </VCard>

    <VSnackbar
      v-model="randomMessageStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="randomMessageStore.snackbar.color"
    >
      {{ randomMessageStore.snackbar.message }}
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
