import type { ListChatsResult } from '../types/chat';

export type ChatTab = 'all' | 'queue' | 'in_chat' | 'chatbot';

export type RootStackParamList = {
  ChatList: { tab: ChatTab };
  ChatRoom: { chat: ListChatsResult; mode?: 'default' | 'history_readonly' };
  Contacts: undefined;
};

export type ChatStackParamList = {
  ChatList: { tab: ChatTab };
  ChatRoom: { chat: ListChatsResult; mode?: 'default' | 'history_readonly' };
  Contacts: undefined;
};
