<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { useUsersStore } from '@/@webcore/stores/user';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';

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

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { value: null, title: t('all') },
  { value: EUserStatus.active, title: t('active') },
  { value: EUserStatus.inactive, title: t('inactive') },
]);

const headers: DataTableHeader<ListUserResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('email'), key: 'email' },
  { title: t('phone'), key: 'phone' },
  { title: t('document'), key: 'document' },
  { title: t('status'), key: 'status' },
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

// Estatísticas
const totalUsers = computed(() => userStore.pagings.total);
const activeUsers = computed(() => {
  return userStore.list.filter((user) => user.user_status?.name === t('active'))
    .length;
});
const inactiveUsers = computed(() => {
  return userStore.list.filter(
    (user) => user.user_status?.name === t('inactive')
  ).length;
});

function formatPhone(value: string | null | undefined): string {
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
}

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
        <!-- Cards de Estatísticas -->
        <div class="d-flex gap-4 flex-wrap mb-6">
          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('total_users') }}
                  </div>
                  <div class="text-h5 text-primary font-weight-bold">
                    {{ totalUsers }}
                  </div>
                </div>
                <VIcon icon="tabler-users" size="40" color="primary" />
              </div>
            </VCardText>
          </VCard>

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('active_users') }}
                  </div>
                  <div class="text-h5 text-success font-weight-bold">
                    {{ activeUsers }}
                  </div>
                </div>
                <VIcon icon="tabler-user-check" size="40" color="success" />
              </div>
            </VCardText>
          </VCard>

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('inactive_users') }}
                  </div>
                  <div class="text-h5 text-error font-weight-bold">
                    {{ inactiveUsers }}
                  </div>
                </div>
                <VIcon icon="tabler-user-x" size="40" color="error" />
              </div>
            </VCardText>
          </VCard>
        </div>

        <!-- Filtros -->
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
              <AppSelect
                v-model="options.user_status"
                :items="itemsStatus"
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
              {{ item.account?.name ?? '-' }}
            </span>
          </div>
        </template>

        <template #item.email="{ item }">
          {{ item.email_partial ?? '-' }}
        </template>

        <template #item.phone="{ item }">
          {{
            item.user_info?.phone_partial
              ? formatPhone(item.user_info.phone_partial)
              : '-'
          }}
        </template>

        <template #item.document="{ item }">
          {{ item.user_document?.document_partial ?? '-' }}
        </template>

        <template #item.status="{ item }">
          <VChip
            :color="
              item.user_status?.name === t('active') ? 'success' : 'error'
            "
            size="small"
          >
            {{ item.user_status?.name ?? '-' }}
          </VChip>
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
</style>
