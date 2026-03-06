import { searchChats } from '../api/chatApi';
import type { ChatListCounts } from '../types/chat';

type SetChatCounts = (counts: Partial<ChatListCounts>) => void;

export function normalizeChatCounts(
  counts?: Partial<ChatListCounts> | null
): Partial<ChatListCounts> | null {
  if (!counts) return null;

  const schedule = counts.schedule ?? 0;
  const chatbotInput = counts.chatbot_input ?? 0;
  const chatbotOutput = counts.chatbot_output ?? 0;
  const chatbotWebhook = counts.chatbot_webhook ?? 0;
  const chatbotSchedule = counts.chatbot_schedule ?? schedule;
  const inChatMine = counts.in_chat_mine ?? counts.my_chats ?? 0;

  return {
    total: counts.total ?? 0,
    queue: counts.queue ?? 0,
    in_chat: counts.in_chat ?? 0,
    chatbot: counts.chatbot ?? 0,
    schedule,
    my_chats: counts.my_chats ?? 0,
    closed: counts.closed ?? 0,
    in_chat_mine: inChatMine,
    chatbot_input: chatbotInput,
    chatbot_output: chatbotOutput,
    chatbot_schedule: chatbotSchedule,
    chatbot_webhook: chatbotWebhook,
  };
}

export async function syncGlobalChatCounts(
  setChatCounts: SetChatCounts
): Promise<void> {
  try {
    const response = await searchChats({
      search: '',
      status: 'in_chat',
      current_page: 1,
      per_page: 1,
    });
    const normalizedCounts = normalizeChatCounts(response?.counts);
    if (!normalizedCounts) return;
    setChatCounts(normalizedCounts);
  } catch {
    // Keep current counters when sync is unavailable.
  }
}
