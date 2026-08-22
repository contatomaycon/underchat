import { readonly, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import type {
  ChatbotInactivityOption,
  ChatbotInactivityTargetOption,
} from '@/types/chatbotInactivityAlert';

export function useChatbotInactivityTargets() {
  const { t } = useI18n();
  const chatbotStore = useChatbotStore();
  const channels = ref<ChatbotInactivityOption[]>([]);
  const chatbots = ref<ChatbotInactivityTargetOption[]>([]);
  const selectedChannelId = shallowRef<string | null>(null);
  const selectedChatbotId = shallowRef<string | null>(null);
  const isLoadingChannels = shallowRef(false);
  const isLoadingChatbots = shallowRef(false);

  async function loadChannels(): Promise<void> {
    isLoadingChannels.value = true;
    try {
      const result = await chatbotStore.listChatbotChannels();
      channels.value = result.map((channel) => ({
        value: channel.id,
        title: channel.number
          ? `${channel.name} (${channel.number})`
          : channel.name,
      }));
    } finally {
      isLoadingChannels.value = false;
    }
  }

  async function loadChatbots(workerId: string): Promise<void> {
    isLoadingChatbots.value = true;
    try {
      const result = await chatbotStore.listChannelChatbots(workerId);
      chatbots.value = result.map((chatbot) => ({
        value: chatbot.chatbot_id,
        title: `${chatbot.name} (${t(
          chatbot.type === 'input'
            ? 'chatbot_type_input'
            : 'chatbot_type_output'
        )})`,
        type: chatbot.type,
      }));
    } finally {
      isLoadingChatbots.value = false;
    }
  }

  async function changeChannel(workerId: string | null): Promise<void> {
    selectedChannelId.value = workerId;
    selectedChatbotId.value = null;
    chatbots.value = [];
    if (workerId) await loadChatbots(workerId);
  }

  async function restoreSelection(
    workerId?: string | null,
    chatbotId?: string | null
  ): Promise<void> {
    const availableWorkerId =
      workerId && channels.value.some((channel) => channel.value === workerId)
        ? workerId
        : null;

    selectedChannelId.value = availableWorkerId;
    selectedChatbotId.value = null;
    chatbots.value = [];
    if (!availableWorkerId) return;
    await loadChatbots(availableWorkerId);
    selectedChatbotId.value =
      chatbotId && chatbots.value.some((chatbot) => chatbot.value === chatbotId)
        ? chatbotId
        : null;
  }

  return {
    channels: readonly(channels),
    chatbots: readonly(chatbots),
    selectedChannelId,
    selectedChatbotId,
    isLoadingChannels: readonly(isLoadingChannels),
    isLoadingChatbots: readonly(isLoadingChatbots),
    loadChannels,
    loadChatbots,
    changeChannel,
    restoreSelection,
  };
}
