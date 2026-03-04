import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ListChatsResult } from '../types/chat';

export type ChatTab = 'all' | 'queue' | 'in_chat' | 'closed' | 'chatbot';

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

export type RootTabParamList = {
  New: NavigatorScreenParams<ChatStackParamList> & {
    tab?: ChatTab;
    entry?: 'contacts';
  };
  InChat: NavigatorScreenParams<ChatStackParamList> & { tab?: ChatTab };
  Queue: NavigatorScreenParams<ChatStackParamList> & { tab?: ChatTab };
  Closed: NavigatorScreenParams<ChatStackParamList> & { tab?: ChatTab };
  Chatbot: NavigatorScreenParams<ChatStackParamList> & { tab?: ChatTab };
};
