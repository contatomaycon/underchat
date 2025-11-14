<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { getAdministrator } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { EMessageTemplatePermissions } from '@core/common/enums/EPermissions/messageTemplate';
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { ListMessageTemplateResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EMessageTemplatePermissions.message_list,
      EMessageTemplatePermissions.message_view,
      EMessageTemplatePermissions.message_create,
      EMessageTemplatePermissions.message_update,
      EMessageTemplatePermissions.message_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_create,
];

const { t } = useI18n();
const messageTemplateStore = useMessageTemplateStore();
const isAdministrator = getAdministrator();

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
  { id: EMessageStatus.active, text: t('active') },
  { id: EMessageStatus.inactive, text: t('inactive') },
]);

const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const pdfExts = new Set(['pdf']);
const audioExts = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);

function getExtFromUrl(url: string | null | undefined): string {
  if (!url) return '';

  const getLastSegment = (value: string) => {
    const clean = value.split(/[?#]/)[0];
    return clean.split('/').findLast((segment) => segment.length > 0) ?? '';
  };

  try {
    const u = new URL(url);
    const last = getLastSegment(u.pathname);
    const i = last.lastIndexOf('.');
    return i >= 0 ? last.slice(i + 1).toLowerCase() : '';
  } catch {
    const last = getLastSegment(url);
    const i = last.lastIndexOf('.');
    return i >= 0 ? last.slice(i + 1).toLowerCase() : '';
  }
}

function getAttachmentIcon(url: string | null | undefined): string {
  const ext = getExtFromUrl(url);

  if (imageExts.has(ext)) return 'tabler-photo';
  if (pdfExts.has(ext)) return 'tabler-file-type-pdf';
  if (audioExts.has(ext)) return 'tabler-music';

  return 'tabler-file'; // default
}

function openAttachment(url: string | null | undefined) {
  if (!url) return;
  window.open(url, '_blank');
}

const isDialogDeleterShow = ref(false);
const messageTemplateToDelete = ref<string | null>(null);

const isDialogEditMessageTemplateShow = ref(false);
const isAddMessageTemplateVisible = ref(false);
const messageTemplateToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListMessageTemplateResponse>[] = [
  { title: t('message'), key: 'message' },
  { title: t('shortcut'), key: 'command' },
  { title: t('message_status'), key: 'message_status' },
  { title: t('attachment'), key: 'attachment_url' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  message_status: null as string | null,
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
  message_status: options.value.message_status,
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

const deleteMessageTemplate = async (id: string) => {
  messageTemplateToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!messageTemplateToDelete.value) return;

  const result = await messageTemplateStore.deleteMessageTemplate(
    messageTemplateToDelete.value
  );
  if (result) {
    await messageTemplateStore.listMessageTemplate(query.value);
  }

  messageTemplateToDelete.value = null;
};

const openEditDialog = (id: string) => {
  messageTemplateToEdit.value = id;

  isDialogEditMessageTemplateShow.value = true;
};

watch(
  query,
  async (q) => {
    await messageTemplateStore.listMessageTemplate(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('messages_template')" no-padding>
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
              @click="isAddMessageTemplateVisible = true"
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
                v-model="options.message_status"
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
        :items="messageTemplateStore.list"
        :items-length="messageTemplateStore.pagings.total"
        :loading="messageTemplateStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.message="{ item }">
          <span class="d-inline-block text-truncate" style="max-width: 350px">
            {{ item.message }}
          </span>
        </template>

        <template #item.command="{ item }">
          {{ $t(`${item.command}`) }}
        </template>

        <template #item.message_status="{ item }">
          {{ $t(`${item.message_status?.name}`) }}
        </template>

        <template #item.attachment_url="{ item }">
          <div v-if="item.attachment_url" class="d-flex align-center">
            <IconBtn @click="openAttachment(item.attachment_url)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ item.attachment_url }}</span>
              </VTooltip>
              <VIcon :icon="getAttachmentIcon(item.attachment_url)" />
            </IconBtn>
          </div>
          <span v-else class="text-medium-emphasis">-</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                $canPermission(permissionsEdit) &&
                (item?.message_template_id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_message_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.message_template_id)"
            /></IconBtn>

            <IconBtn
              v-if="
                $canPermission(permissionsDelete) &&
                (item.message_template_id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_message_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteMessageTemplate(item.message_template_id)"
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
            :total-items="messageTemplateStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_message_template')"
        :message="$t('delete_message_template_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditMessageTemplate
        v-if="isDialogEditMessageTemplateShow"
        v-model="isDialogEditMessageTemplateShow"
        :message-template-id="messageTemplateToEdit"
      />

      <AppAddMessageTemplate
        v-if="isAddMessageTemplateVisible"
        v-model="isAddMessageTemplateVisible"
      />
    </VCard>

    <VSnackbar
      v-model="messageTemplateStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="messageTemplateStore.snackbar.color"
    >
      {{ messageTemplateStore.snackbar.message }}
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
