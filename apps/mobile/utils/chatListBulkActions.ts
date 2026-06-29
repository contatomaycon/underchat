import type {
  ChatbotFilterStatus,
  InChatScope,
} from '../context/ChatFilterContext';
import type { ChatTab } from '../navigation/types';
import type {
  ChatBulkCategory,
  ChatSortField,
  ChatSortOrder,
} from '../types/chatBulkActions';
import type { ChatListCounts, ListChatsResult } from '../types/chat';

export const DEFAULT_CHAT_SORT_FIELD: ChatSortField = 'summary.last_message';
export const DEFAULT_CHAT_SORT_ORDER: ChatSortOrder = 'desc';

export const CHAT_SORT_FIELDS: ChatSortField[] = [
  'summary.last_message',
  'account.name',
  'worker.name',
  'name',
  'phone',
  'status',
  'date',
  'user.name',
  'sector.name',
  'started_at',
  'closed_at',
];

const CHAT_SORT_FIELD_SET = new Set<string>(CHAT_SORT_FIELDS);

export function normalizeChatSortField(
  value: string | null | undefined
): ChatSortField {
  return value && CHAT_SORT_FIELD_SET.has(value)
    ? (value as ChatSortField)
    : DEFAULT_CHAT_SORT_FIELD;
}

export function normalizeChatSortOrder(
  value: string | null | undefined
): ChatSortOrder {
  return value === 'asc' || value === 'desc' ? value : DEFAULT_CHAT_SORT_ORDER;
}

export function resolveBulkCategory(
  tab: ChatTab,
  chatbotFilter?: ChatbotFilterStatus | null
): ChatBulkCategory | null {
  if (tab === 'closed') return null;
  if (tab === 'all') return 'my_chats';
  if (tab === 'chatbot') {
    return chatbotFilter === 'ura_schedule' ? 'scheduled' : 'chatbot';
  }
  return tab;
}

function isCurrentUserChat(
  chat: ListChatsResult,
  currentUserId: string | null | undefined
): boolean {
  if (!currentUserId) return false;
  if (chat.user?.id === currentUserId) return true;
  return (chat.secondary_users ?? []).some((user) => user.id === currentUserId);
}

export function isBulkSelectableChat(
  chat: ListChatsResult,
  category: ChatBulkCategory | null,
  currentUserId?: string | null
): boolean {
  if (!category) return false;

  if (category === 'all') {
    return chat.status === 'in_chat' || chat.status === 'queue';
  }

  if (category === 'in_chat') {
    return chat.status === 'in_chat';
  }

  if (category === 'queue') {
    return chat.status === 'queue';
  }

  if (category === 'my_chats') {
    return (
      (chat.status === 'in_chat' || chat.status === 'queue') &&
      isCurrentUserChat(chat, currentUserId)
    );
  }

  if (category === 'chatbot') {
    return (
      chat.status === 'ura' ||
      chat.status === 'ura_output' ||
      chat.status === 'ura_webhook'
    );
  }

  return chat.status === 'ura_schedule';
}

export function buildBulkSelectionPayload(input: {
  selectAllFiltered: boolean;
  selectedChatIds: string[];
  category: ChatBulkCategory | null;
}):
  | { selection_mode: 'filtered'; category: ChatBulkCategory }
  | { selection_mode: 'selected'; chat_ids: string[] } {
  if (input.selectAllFiltered && input.category) {
    return {
      selection_mode: 'filtered',
      category: input.category,
    };
  }

  const chatIds = Array.from(
    new Set(
      input.selectedChatIds
        .map((chatId) => chatId.trim())
        .filter((chatId) => chatId.length > 0)
    )
  );

  return {
    selection_mode: 'selected',
    chat_ids: chatIds,
  };
}

export function resolveBulkTargetCount(input: {
  category: ChatBulkCategory | null;
  selectAllFiltered: boolean;
  selectedCount: number;
  counts: ChatListCounts;
  visibleSelectableCount: number;
  inChatScope?: InChatScope;
}): number {
  if (!input.selectAllFiltered || !input.category) {
    return input.selectedCount;
  }

  let count = 0;

  if (input.category === 'all') {
    count = (input.counts.in_chat ?? 0) + (input.counts.queue ?? 0);
  } else if (input.category === 'in_chat') {
    count =
      input.inChatScope === 'mine'
        ? (input.counts.in_chat_mine ?? input.counts.my_chats ?? 0)
        : (input.counts.in_chat ?? 0);
  } else if (input.category === 'queue') {
    count = input.counts.queue ?? 0;
  } else if (input.category === 'my_chats') {
    count = input.counts.my_chats ?? input.counts.in_chat_mine ?? 0;
  } else if (input.category === 'chatbot') {
    count = input.counts.chatbot ?? 0;
  } else if (input.category === 'scheduled') {
    count = input.counts.chatbot_schedule ?? input.counts.schedule ?? 0;
  }

  return count > 0 ? count : input.visibleSelectableCount;
}
