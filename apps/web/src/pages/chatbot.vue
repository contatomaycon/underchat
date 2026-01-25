<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { DataTableHeader } from 'vuetify';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useRouter } from 'vue-router';
import AppAddChatbot from '@/components/chatbot/AppAddChatbot.vue';
import AppEditChatbot from '@/components/chatbot/AppEditChatbot.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import TablePagination from '@/@webcore/components/TablePagination.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ],
  },
});

const { t } = useI18n();
const router = useRouter();
const chatbotStore = useChatbotStore();
useSnackbarCleanup(chatbotStore);

const headers: DataTableHeader<ListChatbotResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('chatbot_type'), key: 'type' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const isAddModalOpen = ref(false);
const isEditModalOpen = ref(false);
const editingChatbotId = ref<string | null>(null);
const isDialogDeleterShow = ref(false);
const chatbotToDelete = ref<string | null>(null);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const options = ref({
  page: 1,
  itemsPerPage: 10,
});

const paginatedList = computed(() => {
  if (options.value.itemsPerPage === -1) {
    return chatbotStore.list;
  }

  const start = (options.value.page - 1) * options.value.itemsPerPage;
  const end = start + options.value.itemsPerPage;

  return chatbotStore.list.slice(start, end);
});

const totalItems = computed(() => chatbotStore.list.length);

const editChatbot = (id: string) => {
  editingChatbotId.value = id;
  isEditModalOpen.value = true;
};

const deleteChatbot = (id: string) => {
  chatbotToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!chatbotToDelete.value) {
    return;
  }

  await chatbotStore.deleteChatbot(chatbotToDelete.value);
  chatbotToDelete.value = null;
};

const openConfigurations = (id: string) => {
  router.push(`/chatbot-flow/${id}`);
};

const openAddModal = () => {
  isAddModalOpen.value = true;
};

const getChatbotTypeDisplay = (type: string | null | undefined) => {
  if (type === EChatbotType.output) {
    return { color: 'error' as const, textKey: 'chatbot_type_output' };
  }
  if (type === EChatbotType.schedule) {
    return { color: 'info' as const, textKey: 'chatbot_type_schedule' };
  }
  return { color: 'success' as const, textKey: 'chatbot_type_input' };
};

const handleCreated = async () => {
  await chatbotStore.listChatbots();
};

const handleUpdated = async () => {
  editingChatbotId.value = null;
  await chatbotStore.listChatbots();
};

onMounted(async () => {
  await chatbotStore.listChatbots();
});
</script>

<template>
  <div>
    <VCard :title="$t('chatbots')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center">
            <div class="d-flex align-center gap-x-2">
              <div>{{ $t('show') }}</div>
              <AppSelect
                :model-value="options.itemsPerPage"
                :items="itemsPerPage"
                @update:model-value="
                  options.itemsPerPage = parseInt($event, 10);
                  options.page = 1;
                "
              />
            </div>

            <VBtn
              prepend-icon="tabler-plus"
              color="primary"
              @click="openAddModal"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
        </div>

        <VDivider class="my-4" />

        <VDataTable
          class="data-table"
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          :headers="headers"
          :items="paginatedList"
          :items-length="totalItems"
          :loading="chatbotStore.loading"
          :loading-text="$t('loading_text')"
        >
          <template #item.name="{ item }">
            {{ item.name }}
          </template>

          <template #item.type="{ item }">
            <VChip
              size="small"
              :color="getChatbotTypeDisplay(item.type).color"
              variant="tonal"
            >
              {{ $t(getChatbotTypeDisplay(item.type).textKey) }}
            </VChip>
          </template>

          <template #item.created_at="{ item }">
            {{ formatDateTime(item.created_at) }}
          </template>

          <template #item.actions="{ item }">
            <div class="d-flex gap-1">
              <IconBtn>
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('configurations') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-settings"
                  @click="openConfigurations(item.chatbot_id)"
                />
              </IconBtn>

              <IconBtn>
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('edit') }} {{ $t('chatbot') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-edit"
                  @click="editChatbot(item.chatbot_id)"
                />
              </IconBtn>

              <IconBtn>
                <VTooltip
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ $t('delete') }} {{ $t('chatbot') }}</span>
                </VTooltip>
                <VIcon
                  icon="tabler-trash"
                  @click="deleteChatbot(item.chatbot_id)"
                />
              </IconBtn>
            </div>
          </template>

          <template #no-data>
            {{ $t('no_data_available') }}
          </template>

          <template #bottom>
            <TablePagination
              v-if="options.itemsPerPage !== -1"
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="totalItems"
            />
          </template>
        </VDataTable>
      </VCardText>
    </VCard>

    <AppAddChatbot v-model="isAddModalOpen" @created="handleCreated" />

    <AppEditChatbot
      v-model="isEditModalOpen"
      :chatbot-id="editingChatbotId"
      @updated="handleUpdated"
    />

    <VDialogHandler
      v-model="isDialogDeleterShow"
      :title="$t('delete') + ' ' + $t('chatbot')"
      :message="$t('delete_chatbot_confirmation')"
      @confirm="handleDelete"
    />

    <VSnackbar
      v-model="chatbotStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="chatbotStore.snackbar.color"
    >
      {{ chatbotStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
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
