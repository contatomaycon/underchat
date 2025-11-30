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

const editChatbot = (id: string) => {
  // Por enquanto não faz nada
};

const deleteChatbot = (id: string) => {
  // Por enquanto não faz nada
};

const addChatbot = () => {
  router.push('/chatbot-flow');
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
          <VBtn prepend-icon="tabler-plus" color="primary" @click="addChatbot">
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
            <div class="d-flex gap-2">
              <VBtn
                icon
                size="small"
                variant="text"
                color="primary"
                @click="editChatbot(item.chatbot_id)"
              >
                <VIcon icon="tabler-edit" size="20" />
              </VBtn>
              <VBtn
                icon
                size="small"
                variant="text"
                color="error"
                @click="deleteChatbot(item.chatbot_id)"
              >
                <VIcon icon="tabler-trash" size="20" />
              </VBtn>
            </div>
          </template>

          <template #no-data>
            {{ $t('no_data_available') }}
          </template>
        </VDataTable>
      </VCardText>
    </VCard>
  </div>
</template>
