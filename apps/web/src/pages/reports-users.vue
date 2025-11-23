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
      EGeneralPermissions.full_access_group,
      EUserPermissions.user_group,
      EUserPermissions.user_view,
    ],
  },
});

const { t } = useI18n();
const userStore = useUsersStore();

const previewData = ref<{
  userId: string | null;
  type: 'email' | 'phone' | 'document' | null;
  value: string | null;
  isLoading: boolean;
}>({
  userId: null,
  type: null,
  value: null,
  isLoading: false,
});

const getAccountStatusColor = (
  statusId?: string | null,
  statusName?: string | null
) => {
  if (!statusId && !statusName) {
    return 'error';
  }

  const isActive =
    String(statusId) === String(EUserStatus.active) ||
    statusName?.toLowerCase() === 'active' ||
    statusName?.toLowerCase() === 'ativo';

  return isActive ? 'success' : 'error';
};

const togglePreview = async (
  userId: string,
  type: 'email' | 'phone' | 'document',
  partialValue: string | null | undefined
) => {
  if (
    previewData.value.userId === userId &&
    previewData.value.type === type &&
    previewData.value.value
  ) {
    previewData.value = {
      userId: null,
      type: null,
      value: null,
      isLoading: false,
    };
    return;
  }

  if (!partialValue) return;

  previewData.value = {
    userId,
    type,
    value: null,
    isLoading: true,
  };

  try {
    let decryptedValue: string | null = null;

    if (type === 'email') {
      decryptedValue = await userStore.getUserEmailDecrypted(userId);
    } else if (type === 'phone') {
      decryptedValue = await userStore.getUserPhoneDecrypted(userId);
    } else if (type === 'document') {
      decryptedValue = await userStore.getUserDocumentDecrypted(userId);
    }

    previewData.value.value = decryptedValue;
  } catch (error) {
    previewData.value.value = null;
  } finally {
    previewData.value.isLoading = false;
  }
};

const formatPhone = (value: string | null | undefined): string => {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

const getDisplayValue = (
  item: ListUserResponse,
  type: 'email' | 'phone' | 'document'
): string => {
  if (
    previewData.value.userId === item.user_id &&
    previewData.value.type === type &&
    previewData.value.value
  ) {
    if (type === 'phone') {
      return formatPhone(previewData.value.value);
    }
    return previewData.value.value;
  }

  if (type === 'email') {
    return item.email_partial ?? '';
  }
  if (type === 'phone') {
    return item.user_info?.phone_partial ?? '';
  }
  if (type === 'document') {
    return item.user_document?.document_partial ?? '';
  }

  return '';
};

const isPreviewVisible = (
  userId: string,
  type: 'email' | 'phone' | 'document'
): boolean => {
  return (
    previewData.value.userId === userId &&
    previewData.value.type === type &&
    !!previewData.value.value
  );
};

const isLoadingPreview = (
  userId: string,
  type: 'email' | 'phone' | 'document'
): boolean => {
  return (
    previewData.value.userId === userId &&
    previewData.value.type === type &&
    previewData.value.isLoading
  );
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
  { id: '', text: t('all') },
  { id: EUserStatus.active, text: t('active') },
  { id: EUserStatus.inactive, text: t('inactive') },
]);

const headers: DataTableHeader<ListUserResponse>[] = [
  { title: t('account'), key: 'account' },
  { title: t('status'), key: 'status' },
  { title: t('email_partial'), key: 'email_partial' },
  { title: t('phone_partial'), key: 'phone_partial' },
  { title: t('document_partial'), key: 'document_partial' },
  { title: t('created_at'), key: 'created_at' },
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
  user_status: options.value.user_status || undefined,
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
    <VCard :title="$t('users_report')" no-padding>
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
        <template #item.account="{ item }">
          {{ item.account?.name }}
        </template>

        <template #item.status="{ item }">
          <VChip
            :color="
              getAccountStatusColor(
                item.user_status?.id,
                item.user_status?.name
              )
            "
            size="small"
          >
            {{ item.user_status?.name }}
          </VChip>
        </template>

        <template #item.email_partial="{ item }">
          <div class="d-flex align-center gap-2 preview-cell">
            <span class="flex-grow-1">{{
              getDisplayValue(item, 'email') || '-'
            }}</span>
            <IconBtn
              v-if="item.email_partial"
              size="small"
              class="preview-icon-btn"
              @click="togglePreview(item.user_id, 'email', item.email_partial)"
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>
                  {{
                    isPreviewVisible(item.user_id, 'email')
                      ? $t('hide')
                      : $t('view')
                  }}
                </span>
              </VTooltip>
              <VIcon
                :icon="
                  isPreviewVisible(item.user_id, 'email')
                    ? 'tabler-eye-off'
                    : 'tabler-eye'
                "
                :class="{
                  'opacity-50': isLoadingPreview(item.user_id, 'email'),
                }"
                size="small"
              />
            </IconBtn>
          </div>
        </template>

        <template #item.phone_partial="{ item }">
          <div class="d-flex align-center gap-2 preview-cell">
            <span class="flex-grow-1">{{
              getDisplayValue(item, 'phone') || '-'
            }}</span>
            <IconBtn
              v-if="item.user_info?.phone_partial"
              size="small"
              class="preview-icon-btn"
              @click="
                togglePreview(
                  item.user_id,
                  'phone',
                  item.user_info?.phone_partial
                )
              "
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>
                  {{
                    isPreviewVisible(item.user_id, 'phone')
                      ? $t('hide')
                      : $t('view')
                  }}
                </span>
              </VTooltip>
              <VIcon
                :icon="
                  isPreviewVisible(item.user_id, 'phone')
                    ? 'tabler-eye-off'
                    : 'tabler-eye'
                "
                :class="{
                  'opacity-50': isLoadingPreview(item.user_id, 'phone'),
                }"
                size="small"
              />
            </IconBtn>
          </div>
        </template>

        <template #item.document_partial="{ item }">
          <div class="d-flex align-center gap-2 preview-cell">
            <span class="flex-grow-1">{{
              getDisplayValue(item, 'document') || '-'
            }}</span>
            <IconBtn
              v-if="item.user_document?.document_partial"
              size="small"
              class="preview-icon-btn"
              @click="
                togglePreview(
                  item.user_id,
                  'document',
                  item.user_document?.document_partial
                )
              "
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>
                  {{
                    isPreviewVisible(item.user_id, 'document')
                      ? $t('hide')
                      : $t('view')
                  }}
                </span>
              </VTooltip>
              <VIcon
                :icon="
                  isPreviewVisible(item.user_id, 'document')
                    ? 'tabler-eye-off'
                    : 'tabler-eye'
                "
                :class="{
                  'opacity-50': isLoadingPreview(item.user_id, 'document'),
                }"
                size="small"
              />
            </IconBtn>
          </div>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at ?? null) }}</span>
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

.preview-cell {
  min-height: 40px;
  align-items: center;
}

.preview-icon-btn {
  min-width: 32px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
}
</style>
