<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { DataTableHeader } from 'vuetify';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useRouter } from 'vue-router';
import AppAddChatbot from '@/components/chatbot/AppAddChatbot.vue';
import AppEditChatbot from '@/components/chatbot/AppEditChatbot.vue';

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
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const isAddModalOpen = ref(false);
const isEditModalOpen = ref(false);
const editingChatbotId = ref<string | null>(null);

const editChatbot = (id: string) => {
  editingChatbotId.value = id;
  isEditModalOpen.value = true;
};

const deleteChatbot = (id: string) => {
  // Por enquanto não faz nada
};

const openConfigurations = (id: string) => {
  router.push(`/chatbot-flow/${id}`);
};

const openAddModal = () => {
  isAddModalOpen.value = true;
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
        <div class="d-flex justify-space-between flex-wrap gap-4 mb-4">
          <VBtn
            prepend-icon="tabler-plus"
            color="primary"
            @click="openAddModal"
          >
            {{ $t('add') }}
          </VBtn>
        </div>

        <VDataTable
          :headers="headers"
          :items="chatbotStore.list"
          :loading="chatbotStore.loading"
          :loading-text="$t('loading_text')"
        >
          <template #item.name="{ item }">
            {{ item.name }}
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
        </VDataTable>
      </VCardText>
    </VCard>

    <AppAddChatbot v-model="isAddModalOpen" @created="handleCreated" />

    <AppEditChatbot
      v-model="isEditModalOpen"
      :chatbot-id="editingChatbotId"
      @updated="handleUpdated"
    />
  </div>
</template>
