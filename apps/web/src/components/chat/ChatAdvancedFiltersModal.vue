<script lang="ts" setup>
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useChatStore } from '@/@webcore/stores/chat';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { EColor } from '@core/common/enums/EColor';

interface Props {
  modelValue: boolean;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'filtersUpdated'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const chatbotStore = useChatbotStore();
const chatStore = useChatStore();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const tags = ref<ChatbotChatTagResponse[]>([]);
const isLoadingTags = ref(false);

const filterLabelTemplateId = ref<string | null>(
  chatStore.user?.chat_user?.filter_label_template_id ?? null
);

const sortInChatOrder = ref<string | null>(
  chatStore.user?.chat_user?.sort_in_chat_order ?? null
);
const sortMyChatsOrder = ref<string | null>(
  chatStore.user?.chat_user?.sort_my_chats_order ?? null
);
const sortQueueOrder = ref<string | null>(
  chatStore.user?.chat_user?.sort_queue_order ?? null
);
const sortChatbotOrder = ref<string | null>(
  chatStore.user?.chat_user?.sort_chatbot_order ?? null
);

const sortOptions = [
  { value: 'asc', title: 'Crescente' },
  { value: 'desc', title: 'Decrescente' },
];

const loadTags = async () => {
  if (tags.value.length > 0) return;

  isLoadingTags.value = true;
  try {
    const result = await chatbotStore.listChatbotTags();
    tags.value = result;
  } catch (error) {
    console.error('Error loading tags:', error);
    tags.value = [];
  } finally {
    isLoadingTags.value = false;
  }
};

const handleSave = async () => {
  if (!chatStore.user?.user_id) return;

  const updateData: UpdateChatsUserRequest = {
    about: chatStore.user?.chat_user?.about ?? null,
    notifications: chatStore.user?.chat_user?.notifications ?? true,
    filter_label_template_id: filterLabelTemplateId.value,
    sort_in_chat_order: sortInChatOrder.value,
    sort_my_chats_order: sortMyChatsOrder.value,
    sort_queue_order: sortQueueOrder.value,
    sort_chatbot_order: sortChatbotOrder.value,
  };

  try {
    await chatStore.updateChatsUser(updateData);
    isVisible.value = false;
    emit('filtersUpdated');
    chatStore.showSnackbar(
      chatStore.i18n.global.t('filters_saved_successfully'),
      EColor.success
    );
  } catch (error) {
    console.error('Error saving filters:', error);
    chatStore.showSnackbar(
      chatStore.i18n.global.t('error_saving_filters'),
      EColor.error
    );
  }
};

const handleReset = () => {
  filterLabelTemplateId.value = null;
  sortInChatOrder.value = null;
  sortMyChatsOrder.value = null;
  sortQueueOrder.value = null;
  sortChatbotOrder.value = null;
};

watch(isVisible, (visible) => {
  if (visible) {
    loadTags();
    filterLabelTemplateId.value =
      chatStore.user?.chat_user?.filter_label_template_id ?? null;
    sortInChatOrder.value =
      chatStore.user?.chat_user?.sort_in_chat_order ?? null;
    sortMyChatsOrder.value =
      chatStore.user?.chat_user?.sort_my_chats_order ?? null;
    sortQueueOrder.value = chatStore.user?.chat_user?.sort_queue_order ?? null;
    sortChatbotOrder.value =
      chatStore.user?.chat_user?.sort_chatbot_order ?? null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ $t('advanced_filters') }}</span>
        <IconBtn @click="isVisible = false">
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <VRow>
          <VCol cols="12">
            <h6 class="text-h6 mb-4">{{ $t('filters') }}</h6>
          </VCol>

          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('filter_by_tag') }}</VLabel>
            <AppSelect
              v-model="filterLabelTemplateId"
              :items="
                tags.map((tag) => ({
                  value: tag.label_template_id,
                  title: tag.label,
                  color: tag.color,
                }))
              "
              :placeholder="$t('select_tag')"
              :loading="isLoadingTags"
              clearable
              item-value="value"
              item-title="title"
            >
              <template #item-prepend="{ item }">
                <VAvatar
                  v-if="item.color"
                  :color="item.color"
                  size="24"
                  class="me-2"
                />
              </template>
              <template #selection="{ item }">
                <div class="d-flex align-center">
                  <VAvatar
                    v-if="item.color"
                    :color="item.color"
                    size="20"
                    class="me-2"
                  />
                  <span>{{ item.title }}</span>
                </div>
              </template>
            </AppSelect>
          </VCol>

          <VCol cols="12" class="mt-6">
            <VDivider />
          </VCol>

          <VCol cols="12" class="mt-4">
            <h6 class="text-h6 mb-4">{{ $t('sorting') }}</h6>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{
              $t('sort_in_chat')
            }}</VLabel>
            <AppSelect
              v-model="sortInChatOrder"
              :items="sortOptions"
              :placeholder="$t('select_order')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{
              $t('sort_my_chats')
            }}</VLabel>
            <AppSelect
              v-model="sortMyChatsOrder"
              :items="sortOptions"
              :placeholder="$t('select_order')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{
              $t('sort_queue')
            }}</VLabel>
            <AppSelect
              v-model="sortQueueOrder"
              :items="sortOptions"
              :placeholder="$t('select_order')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{
              $t('sort_chatbot')
            }}</VLabel>
            <AppSelect
              v-model="sortChatbotOrder"
              :items="sortOptions"
              :placeholder="$t('select_order')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>
        </VRow>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="handleReset">
          {{ $t('reset') }}
        </VBtn>
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn :loading="chatStore.loading" @click="handleSave">
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
