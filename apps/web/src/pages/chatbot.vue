<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { DataTableHeader } from 'vuetify';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useRouter } from 'vue-router';
import { requiredValidator } from '@/@webcore/utils/validators';

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
const chatbotName = ref('');
const isCreating = ref(false);
const refForm = ref();

const nameRules = computed(() => [
  requiredValidator(chatbotName.value, t('name_required')),
  () => {
    const nameExists = chatbotStore.list.some(
      (chatbot) =>
        chatbot.name.toLowerCase().trim() ===
        chatbotName.value.toLowerCase().trim()
    );
    if (nameExists) {
      return t('chatbot_name_already_exists');
    }
    return true;
  },
]);

const editChatbot = (id: string) => {
  // Por enquanto não faz nada
};

const deleteChatbot = (id: string) => {
  // Por enquanto não faz nada
};

const openAddModal = () => {
  isAddModalOpen.value = true;
  chatbotName.value = '';
};

const closeAddModal = () => {
  isAddModalOpen.value = false;
  chatbotName.value = '';
  refForm.value?.resetValidation();
};

const handleCreateChatbot = async () => {
  const { valid } = await refForm.value?.validate();
  if (!valid) return;

  isCreating.value = true;
  try {
    const result = await chatbotStore.createChatbot({
      name: chatbotName.value.trim(),
    });

    if (result) {
      closeAddModal();
      await chatbotStore.listChatbots();
    }
  } finally {
    isCreating.value = false;
  }
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

    <VDialog v-model="isAddModalOpen" max-width="500" persistent>
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ $t('add') }} {{ $t('chatbot') }}</span>
          <VBtn
            icon
            size="small"
            variant="text"
            @click="closeAddModal"
            :disabled="isCreating"
          >
            <VIcon icon="tabler-x" />
          </VBtn>
        </VCardTitle>
        <VDivider />
        <VCardText class="pa-4">
          <VForm ref="refForm" @submit.prevent="handleCreateChatbot">
            <VTextField
              v-model="chatbotName"
              :label="$t('name')"
              :placeholder="$t('chatbot_name_placeholder')"
              :rules="nameRules"
              :disabled="isCreating"
              autofocus
            />
          </VForm>
        </VCardText>
        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            @click="closeAddModal"
            :disabled="isCreating"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            :loading="isCreating"
            @click="handleCreateChatbot"
          >
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>
  </div>
</template>
