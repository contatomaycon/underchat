<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { DataTableHeader } from 'vuetify';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { EColor } from '@core/common/enums/EColor';
import TablePagination from '@/@webcore/components/TablePagination.vue';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const channels = ref<ListChannelsResponse[]>([]);
const total = ref(0);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: EWorkerStatus.disponible, text: t('disponible') },
  { id: EWorkerStatus.offline, text: t('offline') },
  { id: EWorkerStatus.online, text: t('online') },
  { id: EWorkerStatus.new, text: t('new') },
  { id: EWorkerStatus.creating, text: t('creating') },
  { id: EWorkerStatus.error, text: t('error') },
  { id: EWorkerStatus.mismatched, text: t('mismatched') },
]);

const itemsType = ref([
  { id: EWorkerType.baileys, text: t('unofficial') },
  { id: EWorkerType.whatsapp, text: t('official') },
]);

const resolveStatusVariant = (s: string | undefined | null) => {
  if (s === EWorkerStatus.disponible)
    return { color: EColor.warning, text: t('disponible') };
  if (s === EWorkerStatus.offline)
    return { color: EColor.error, text: t('offline') };
  if (s === EWorkerStatus.online)
    return { color: EColor.success, text: t('online') };
  if (s === EWorkerStatus.new) return { color: EColor.info, text: t('new') };
  if (s === EWorkerStatus.creating)
    return { color: EColor.warning, text: t('creating') };
  if (s === EWorkerStatus.error)
    return { color: EColor.error, text: t('error') };
  if (s === EWorkerStatus.mismatched)
    return { color: EColor.error, text: t('mismatched') };

  return { color: EColor.primary, text: t('unknown') };
};

const resolveTypeVariant = (s: string | undefined | null) => {
  if (s === EWorkerType.baileys)
    return { color: EColor.info, text: t('unofficial') };
  if (s === EWorkerType.whatsapp)
    return { color: EColor.success, text: t('official') };

  return { color: EColor.error, text: t('unknown') };
};

const headers: DataTableHeader<ListChannelsResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('number'), key: 'number' },
  { title: t('status'), key: 'status' },
  { title: t('type'), key: 'type' },
  { title: t('account'), key: 'account' },
  { title: t('server'), key: 'server' },
  { title: t('connection_date'), key: 'connection_date' },
  { title: t('created_at'), key: 'created_at' },
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
  current_page: options.value.page,
  per_page:
    options.value.itemsPerPage === -1 ? 200 : options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  status: options.value.status || undefined,
  type: options.value.type || undefined,
  name: debouncedSearch.value || undefined,
  number: debouncedSearch.value || undefined,
}));

const loadChannels = async () => {
  loading.value = true;
  const result = await settingsStore.getChannels(query.value);
  if (result) {
    channels.value = result.results;
    total.value = result.pagings.total;
  }
  loading.value = false;
};

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
  async () => {
    await loadChannels();
  },
  { immediate: true, deep: true }
);

onMounted(() => {
  loadChannels();
});
</script>

<template>
  <div>
    <VCard>
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('channels') }}
      </VCardTitle>

      <VDivider />

      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center">
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
              <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
              <AppSelectSearch
                v-model="options.type"
                :items="itemsType"
                :placeholder="$t('select_type')"
                :clearable="true"
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

        <div class="mt-4">
          <VDataTable
            :headers="headers"
            :items="channels"
            :loading="loading || settingsStore.loading"
            :items-per-page="
              options.itemsPerPage === -1 ? total : options.itemsPerPage
            "
            :page="options.page"
            :server-items-length="total"
            @update:options="handleTableChange"
          >
            <template #item.name="{ item }">
              {{ item.name }}
            </template>

            <template #item.number="{ item }">
              <span v-if="item.number">
                {{ formatPhoneBR(item.number) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.status="{ item }">
              <VChip
                v-if="item.status"
                :color="resolveStatusVariant(item.status.id).color"
                size="small"
              >
                {{ resolveStatusVariant(item.status.id).text }}
              </VChip>
              <span v-else>-</span>
            </template>

            <template #item.type="{ item }">
              <VChip
                v-if="item.type"
                :color="resolveTypeVariant(item.type.id).color"
                size="small"
              >
                {{ resolveTypeVariant(item.type.id).text }}
              </VChip>
              <span v-else>-</span>
            </template>

            <template #item.account="{ item }">
              <span v-if="item.account">{{ item.account.name }}</span>
              <span v-else>-</span>
            </template>

            <template #item.server="{ item }">
              <span v-if="item.server">{{ item.server.name }}</span>
              <span v-else>-</span>
            </template>

            <template #item.connection_date="{ item }">
              <span v-if="item.connection_date">
                {{ formatDateTime(item.connection_date) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.created_at="{ item }">
              <span v-if="item.created_at">
                {{ formatDateTime(item.created_at) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #bottom>
              <TablePagination
                v-if="options.itemsPerPage !== -1"
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="total"
              />
            </template>
          </VDataTable>
        </div>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="settingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="settingsStore.snackbar.color"
    >
      {{ settingsStore.snackbar.message }}
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
</style>
