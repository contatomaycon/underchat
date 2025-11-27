<script setup lang="ts">
import { ref, watch, computed } from 'vue';
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
import { IListUsers } from '@/@webcore/interfaces/IListUsers';

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
  { value: EUserStatus.blocked, title: t('blocked') },
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

const query = computed((): IListUsers => {
  const q: IListUsers = {
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
  };

  // Adicionar user_status apenas se não for null ou string vazia
  if (options.value.user_status && options.value.user_status !== '') {
    q.user_status = options.value.user_status;
  }

  // Adicionar search apenas se não for null ou string vazia
  if (debouncedSearch.value && debouncedSearch.value.trim() !== '') {
    q.search = debouncedSearch.value.trim();
  }

  return q;
});

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
  return userStore.list.filter(
    (user) => user.user_status?.user_status_id === EUserStatus.active
  ).length;
});
const inactiveUsers = computed(() => {
  return userStore.list.filter(
    (user) => user.user_status?.user_status_id === EUserStatus.inactive
  ).length;
});
const blockedUsers = computed(() => {
  return userStore.list.filter(
    (user) => user.user_status?.user_status_id === EUserStatus.blocked
  ).length;
});

const resolveStatusText = (statusId?: string | null) => {
  if (!statusId) {
    return '-';
  }

  if (statusId === EUserStatus.active) {
    return t('active');
  } else if (statusId === EUserStatus.inactive) {
    return t('inactive');
  } else if (statusId === EUserStatus.blocked) {
    return t('blocked');
  }

  return '-';
};

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

// Estados para descriptografia
const decryptedData = ref<
  Record<
    string,
    {
      email: string | null;
      phone: string | null;
      document: string | null;
    }
  >
>({});

const isLoadingDecrypt = ref<
  Record<
    string,
    {
      email: boolean;
      phone: boolean;
      document: boolean;
    }
  >
>({});

const toggleEmailVisibility = async (userId: string, currentEmail: string) => {
  if (!isLoadingDecrypt.value[userId]) {
    isLoadingDecrypt.value[userId] = {
      email: false,
      phone: false,
      document: false,
    };
  }

  if (decryptedData.value[userId]?.email) {
    decryptedData.value[userId].email = null;
    return;
  }

  isLoadingDecrypt.value[userId].email = true;
  const decrypted = await userStore.getUserEmailDecrypted(userId);
  isLoadingDecrypt.value[userId].email = false;

  if (decrypted) {
    if (!decryptedData.value[userId]) {
      decryptedData.value[userId] = {
        email: null,
        phone: null,
        document: null,
      };
    }
    decryptedData.value[userId].email = decrypted;
  }
};

const togglePhoneVisibility = async (userId: string, currentPhone: string) => {
  if (!isLoadingDecrypt.value[userId]) {
    isLoadingDecrypt.value[userId] = {
      email: false,
      phone: false,
      document: false,
    };
  }

  if (decryptedData.value[userId]?.phone) {
    decryptedData.value[userId].phone = null;
    return;
  }

  isLoadingDecrypt.value[userId].phone = true;
  const decrypted = await userStore.getUserPhoneDecrypted(userId);
  isLoadingDecrypt.value[userId].phone = false;

  if (decrypted) {
    if (!decryptedData.value[userId]) {
      decryptedData.value[userId] = {
        email: null,
        phone: null,
        document: null,
      };
    }
    decryptedData.value[userId].phone = decrypted;
  }
};

const toggleDocumentVisibility = async (
  userId: string,
  currentDocument: string
) => {
  if (!isLoadingDecrypt.value[userId]) {
    isLoadingDecrypt.value[userId] = {
      email: false,
      phone: false,
      document: false,
    };
  }

  if (decryptedData.value[userId]?.document) {
    decryptedData.value[userId].document = null;
    return;
  }

  isLoadingDecrypt.value[userId].document = true;
  const decrypted = await userStore.getUserDocumentDecrypted(userId);
  isLoadingDecrypt.value[userId].document = false;

  if (decrypted) {
    if (!decryptedData.value[userId]) {
      decryptedData.value[userId] = {
        email: null,
        phone: null,
        document: null,
      };
    }
    decryptedData.value[userId].document = decrypted;
  }
};

watch(
  query,
  async (q) => {
    await userStore.listUsers(q);
  },
  { immediate: true, deep: true }
);

// Resetar página quando o status ou busca mudar
watch(
  () => options.value.user_status,
  () => {
    options.value.page = 1;
  }
);

watch(
  () => debouncedSearch.value,
  () => {
    options.value.page = 1;
  }
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

          <VCard class="flex-grow-1" min-width="200">
            <VCardText>
              <div class="d-flex justify-space-between align-center">
                <div>
                  <div class="text-body-2 text-medium-emphasis mb-1">
                    {{ $t('blocked_users') }}
                  </div>
                  <div class="text-h5 text-error font-weight-bold">
                    {{ blockedUsers }}
                  </div>
                </div>
                <VIcon icon="tabler-user-off" size="40" color="error" />
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
                :model-value="options.user_status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
                @update:model-value="
                  options.user_status = $event === '' ? null : $event;
                  options.page = 1;
                "
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
                :model-value="options.search"
                @update:model-value="
                  options.search = $event === '' ? null : $event;
                  options.page = 1;
                "
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
          <div class="d-flex align-center justify-space-between">
            <span>
              {{
                decryptedData[item.user_id]?.email ?? item.email_partial ?? '-'
              }}
            </span>
            <VIcon
              v-if="item.email_partial"
              :icon="
                decryptedData[item.user_id]?.email
                  ? 'tabler-eye-off'
                  : 'tabler-eye'
              "
              size="18"
              class="cursor-pointer"
              :class="{
                'text-disabled': isLoadingDecrypt[item.user_id]?.email,
              }"
              @click="toggleEmailVisibility(item.user_id, item.email_partial)"
            />
          </div>
        </template>

        <template #item.phone="{ item }">
          <div class="d-flex align-center justify-space-between">
            <span>
              {{
                decryptedData[item.user_id]?.phone
                  ? formatPhone(decryptedData[item.user_id].phone)
                  : (item.user_info?.phone_partial ?? '-')
              }}
            </span>
            <VIcon
              v-if="item.user_info?.phone_partial"
              :icon="
                decryptedData[item.user_id]?.phone
                  ? 'tabler-eye-off'
                  : 'tabler-eye'
              "
              size="18"
              class="cursor-pointer"
              :class="{
                'text-disabled': isLoadingDecrypt[item.user_id]?.phone,
              }"
              @click="
                togglePhoneVisibility(
                  item.user_id,
                  item.user_info?.phone_partial ?? ''
                )
              "
            />
          </div>
        </template>

        <template #item.document="{ item }">
          <div class="d-flex align-center justify-space-between">
            <span>
              {{
                decryptedData[item.user_id]?.document ??
                item.user_document?.document_partial ??
                '-'
              }}
            </span>
            <VIcon
              v-if="item.user_document?.document_partial"
              :icon="
                decryptedData[item.user_id]?.document
                  ? 'tabler-eye-off'
                  : 'tabler-eye'
              "
              size="18"
              class="cursor-pointer"
              :class="{
                'text-disabled': isLoadingDecrypt[item.user_id]?.document,
              }"
              @click="
                toggleDocumentVisibility(
                  item.user_id,
                  item.user_document?.document_partial ?? ''
                )
              "
            />
          </div>
        </template>

        <template #item.status="{ item }">
          {{ resolveStatusText(item.user_status?.user_status_id) }}
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

.cursor-pointer {
  cursor: pointer;
}
</style>
