import type { ListChatsResult } from '../types/chat';

export type ChatTab = 'all' | 'queue' | 'in_chat' | 'closed' | 'chatbot';

export type RootStackParamList = {
  ChatList: { tab: ChatTab };
  ChatRoom: { chat: ListChatsResult };
  Contacts: undefined;
};

export type ChatStackParamList = {
  ChatList: { tab: ChatTab };
  ChatRoom: { chat: ListChatsResult };
  Contacts: undefined;
};
