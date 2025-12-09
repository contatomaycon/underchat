<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { ELabelTemplatePermissions } from '@core/common/enums/EPermissions/labelTemplate';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';
import { ListLabelTemplateResponse } from '@core/schema/labelTemplate/listLabelTemplate/response.schema';
import { EColor } from '@core/common/enums/EColor';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ELabelTemplatePermissions.label_template_group,
      ELabelTemplatePermissions.label_view,
      ELabelTemplatePermissions.label_create,
      ELabelTemplatePermissions.label_update,
      ELabelTemplatePermissions.label_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_create,
];

const { t } = useI18n();
const labelTemplateStore = useLabelTemplateStore();
useSnackbarCleanup(labelTemplateStore);

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
  { id: ELabelStatus.active, text: t('active') },
  { id: ELabelStatus.inactive, text: t('inactive') },
]);

const isDialogDeleterShow = ref(false);
const labelTemplateToDelete = ref<string | null>(null);

const isDialogEditLabelTemplateShow = ref(false);
const isAddLabelTemplateVisible = ref(false);
const labelTemplateToEdit = ref<string | null>(null);

const isHexColor = (s: string) => /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);

const backgroundColor = (s: string): string => {
  if (isHexColor(s)) return s;

  return EColor.primary;
};

const textColor = (s: string): string => {
  const hex = backgroundColor(s);

  if (!isHexColor(hex)) return '#FFFFFF';

  let c = hex.substring(1);
  if (c.length === 3) {
    c = c
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }

  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);

  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  return yiq >= 128 ? '#000000' : '#FFFFFF';
};

const headers: DataTableHeader<ListLabelTemplateResponse>[] = [
  { title: t('label'), key: 'label' },
  { title: t('label_status'), key: 'label_status' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  label_status: null as string | null,
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
  label_status: options.value.label_status,
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

const deleteLabelTemplate = async (id: string) => {
  labelTemplateToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!labelTemplateToDelete.value) return;

  const result = await labelTemplateStore.deleteLabelTemplate(
    labelTemplateToDelete.value
  );
  if (result) {
    await labelTemplateStore.listLabelTemplate(query.value);
  }

  labelTemplateToDelete.value = null;
};

const openEditDialog = (id: string) => {
  labelTemplateToEdit.value = id;

  isDialogEditLabelTemplateShow.value = true;
};

watch(
  query,
  async (q) => {
    await labelTemplateStore.listLabelTemplate(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('label_template')" no-padding>
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
              @click="isAddLabelTemplateVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.label_status"
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
      </VCardText>

      <VDataTableServer
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        :headers="headers"
        :items="labelTemplateStore.list"
        :items-length="labelTemplateStore.pagings.total"
        :loading="labelTemplateStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.label="{ item }">
          <VChip
            class="uc-chip"
            size="small"
            :style="{
              backgroundColor: backgroundColor(item.color),
              color: textColor(item.color),
            }"
          >
            {{ item.label }}
          </VChip>
        </template>

        <template #item.label_status="{ item }">
          <VChip
            v-if="item.label_status"
            :color="
              item.label_status.label_status_id === ELabelStatus.active
                ? 'success'
                : 'error'
            "
            size="small"
            variant="tonal"
          >
            {{
              item.label_status.label_status_id === ELabelStatus.active
                ? $t('active')
                : $t('inactive')
            }}
          </VChip>
          <span v-else class="text-medium-emphasis">-</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="$canPermission(permissionsEdit) && item?.label_template_id"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_label_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.label_template_id)"
            /></IconBtn>

            <IconBtn
              v-if="$canPermission(permissionsDelete) && item.label_template_id"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_label_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteLabelTemplate(item.label_template_id)"
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
            :total-items="labelTemplateStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_label_template')"
        :message="$t('delete_label_template_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditLabelTemplate
        v-if="isDialogEditLabelTemplateShow"
        v-model="isDialogEditLabelTemplateShow"
        :label-template-id="labelTemplateToEdit"
      />

      <AppAddLabelTemplate
        v-if="isAddLabelTemplateVisible"
        v-model="isAddLabelTemplateVisible"
      />
    </VCard>

    <VSnackbar
      v-model="labelTemplateStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="labelTemplateStore.snackbar.color"
    >
      {{ labelTemplateStore.snackbar.message }}
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

.uc-chip {
  height: 24px;
  min-width: 88px;
  justify-content: center;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
