<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { DataTableHeader } from 'vuetify';
import { EColor } from '@core/common/enums/EColor';
import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { ListS3BackupUploadsResponse } from '@core/schema/config/listS3BackupUploads/response.schema';
import TablePagination from '@/@webcore/components/TablePagination.vue';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const uploads = ref<ListS3BackupUploadsResponse[]>([]);
const total = ref(0);
const accountsLoading = ref(false);
const itemsAccount = ref<Array<{ id: string; text: string }>>([]);

const itemsPerPage = ref([
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
]);

const itemsStatus = ref([
  { id: ES3BackupMigrationStatus.pending, text: t('s3_backup_status_pending') },
  {
    id: ES3BackupMigrationStatus.processing,
    text: t('s3_backup_status_processing'),
  },
  { id: ES3BackupMigrationStatus.failed, text: t('s3_backup_status_failed') },
  {
    id: ES3BackupMigrationStatus.migrated,
    text: t('s3_backup_status_migrated'),
  },
]);

const headers: DataTableHeader<ListS3BackupUploadsResponse>[] = [
  { title: t('account'), key: 'account' },
  { title: t('s3_backup_bucket'), key: 'bucket' },
  { title: t('s3_backup_object_key'), key: 'object_key' },
  { title: t('s3_backup_file_name'), key: 'file_name' },
  { title: t('s3_backup_size'), key: 'size_bytes' },
  { title: t('status'), key: 'migration_status' },
  { title: t('s3_backup_attempts'), key: 'attempts', sortable: false },
  { title: t('s3_backup_last_error'), key: 'migration_last_error' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('s3_backup_migrated_at'), key: 'migrated_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as ES3BackupMigrationStatus | null,
  account: null as string | null,
  search: null as string | null,
  includeDeleted: false,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  current_page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  status: options.value.status ?? undefined,
  account: options.value.account ?? undefined,
  search: debouncedSearch.value ?? undefined,
  include_deleted: options.value.includeDeleted || undefined,
}));

const resolveStatusVariant = (status: string | null) => {
  if (status === ES3BackupMigrationStatus.pending) {
    return { color: EColor.info, text: t('s3_backup_status_pending') };
  }

  if (status === ES3BackupMigrationStatus.processing) {
    return { color: EColor.warning, text: t('s3_backup_status_processing') };
  }

  if (status === ES3BackupMigrationStatus.failed) {
    return { color: EColor.error, text: t('s3_backup_status_failed') };
  }

  if (status === ES3BackupMigrationStatus.migrated) {
    return { color: EColor.success, text: t('s3_backup_status_migrated') };
  }

  return { color: EColor.primary, text: t('unknown') };
};

const formatFileSize = (sizeBytes: number): string => {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const decimals = index === 0 ? 0 : 2;
  return `${value.toFixed(decimals)} ${units[index]}`;
};

const loadAccounts = async () => {
  if (itemsAccount.value.length > 0) {
    return;
  }

  accountsLoading.value = true;
  try {
    const accounts = await settingsStore.getAccounts();

    if (accounts) {
      itemsAccount.value = accounts.map((account: IAccountBasic) => ({
        id: account.account_id,
        text: account.name,
      }));
    }
  } finally {
    accountsLoading.value = false;
  }
};

const loadUploads = async () => {
  loading.value = true;

  const result = await settingsStore.getS3BackupUploads(query.value);

  if (result) {
    uploads.value = result.results;
    total.value = result.pagings.total;
  } else {
    uploads.value = [];
    total.value = 0;
  }

  loading.value = false;
};

const canReprocess = (upload: ListS3BackupUploadsResponse): boolean => {
  if (upload.deleted_at) {
    return false;
  }

  return upload.migration_status !== ES3BackupMigrationStatus.processing;
};

const reprocessUpload = async (s3BackupUploadId: string): Promise<void> => {
  const success = await settingsStore.reprocessS3BackupUpload(s3BackupUploadId);
  if (!success) {
    return;
  }

  await loadUploads();
};

const handleTableChange = (tableOptions: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = tableOptions.page;
  options.value.itemsPerPage = tableOptions.itemsPerPage;
  options.value.sortBy = tableOptions.sortBy;
};

watch(
  query,
  async () => {
    await loadUploads();
  },
  { immediate: true, deep: true }
);

onMounted(async () => {
  await loadAccounts();
});
</script>

<template>
  <VCard>
    <VCardTitle class="text-h6 pa-6 pb-4">
      {{ $t('s3_backup_tab') }}
    </VCardTitle>

    <VDivider />

    <VCardText>
      <div class="d-flex justify-space-between flex-wrap gap-4">
        <div class="d-flex align-center gap-4 flex-wrap">
          <div class="d-flex align-center gap-x-2">
            <div>{{ $t('show') }}</div>
            <AppSelect
              :model-value="options.itemsPerPage"
              :items="itemsPerPage"
              @update:model-value="options.itemsPerPage = parseInt($event, 10)"
            />
          </div>

          <VSwitch
            v-model="options.includeDeleted"
            color="primary"
            hide-details
            inset
            @update:model-value="options.page = 1"
          >
            <template #label>
              {{ $t('s3_backup_include_migrated') }}
            </template>
          </VSwitch>
        </div>

        <div class="d-flex align-center flex-wrap gap-4">
          <div class="status-filter">
            <VLabel class="text-body-2 mb-1">{{ $t('account') }}:</VLabel>
            <AppSelectSearch
              v-model="options.account"
              :items="itemsAccount"
              :placeholder="$t('select_account')"
              :clearable="true"
              :loading="accountsLoading"
              item-value="id"
              item-title="text"
              @update:modelValue="options.page = 1"
            />
          </div>

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

          <div class="search-filter">
            <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
            <AppTextField
              v-model="options.search"
              :placeholder="$t('search') + '...'"
              append-inner-icon="tabler-search"
              single-line
              hide-details
              dense
              outlined
            />
          </div>
        </div>
      </div>

      <VDivider class="my-4" />

      <VDataTable
        :headers="headers"
        :items="uploads"
        :loading="loading || settingsStore.loading"
        :items-per-page="options.itemsPerPage"
        :page="options.page"
        :server-items-length="total"
        @update:options="handleTableChange"
      >
        <template #item.account="{ item }">
          <span>{{ item.account?.name ?? '-' }}</span>
        </template>

        <template #item.bucket="{ item }">
          <span>{{ item.bucket || '-' }}</span>
        </template>

        <template #item.object_key="{ item }">
          <span
            class="text-truncate d-inline-block object-key-col"
            :title="item.object_key"
          >
            {{ item.object_key }}
          </span>
        </template>

        <template #item.file_name="{ item }">
          <span>{{ item.file_name || '-' }}</span>
        </template>

        <template #item.size_bytes="{ item }">
          <span>{{ formatFileSize(item.size_bytes) }}</span>
        </template>

        <template #item.migration_status="{ item }">
          <VChip
            :color="resolveStatusVariant(item.migration_status).color"
            size="small"
          >
            {{ resolveStatusVariant(item.migration_status).text }}
          </VChip>
        </template>

        <template #item.attempts="{ item }">
          <div class="d-flex flex-column text-body-2">
            <span>
              {{ $t('s3_backup_primary_attempts') }}:
              {{ item.primary_attempts }}
            </span>
            <span>
              {{ $t('s3_backup_backup_attempts') }}: {{ item.backup_attempts }}
            </span>
            <span>
              {{ $t('s3_backup_migration_attempts') }}:
              {{ item.migration_attempts }}
            </span>
          </div>
        </template>

        <template #item.migration_last_error="{ item }">
          <span>{{
            item.migration_last_error || item.primary_error || '-'
          }}</span>
        </template>

        <template #item.created_at="{ item }">
          <span v-if="item.created_at">{{
            formatDateTime(item.created_at)
          }}</span>
          <span v-else>-</span>
        </template>

        <template #item.migrated_at="{ item }">
          <span v-if="item.migrated_at">{{
            formatDateTime(item.migrated_at)
          }}</span>
          <span v-else>-</span>
        </template>

        <template #item.actions="{ item }">
          <VBtn
            color="primary"
            variant="tonal"
            size="small"
            prepend-icon="tabler-refresh"
            :disabled="!canReprocess(item)"
            @click="reprocessUpload(item.s3_backup_upload_id)"
          >
            {{ $t('s3_backup_reprocess_now') }}
          </VBtn>
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="total"
          />
        </template>
      </VDataTable>
    </VCardText>
  </VCard>
</template>

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.search-filter {
  inline-size: 20rem;
}

.object-key-col {
  max-inline-size: 22rem;
}
</style>
