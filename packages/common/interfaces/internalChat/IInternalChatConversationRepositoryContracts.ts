import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { IInternalChatUserNamePhoto } from './IInternalChatUserNamePhoto';

export interface IInternalChatCreateDirectConversationInput {
  accountId: string;
  createdByUserId: string;
  userAId: string;
  userBId: string;
  directPairKey: string;
}

export interface IInternalChatCreateGroupConversationInput {
  accountId: string;
  createdByUserId: string;
  name: string;
  photo: string | null;
  memberUserIds: string[];
}

export interface IInternalChatIsUserParticipantInput {
  accountId: string;
  conversationId: string;
  userId: string;
}

export interface IInternalChatListOpenConversationsForUserInput {
  accountId: string;
  userId: string;
  currentPage: number;
  perPage: number;
  search?: string;
}

export interface IInternalChatListOpenConversationsForUserResult {
  conversationIds: string[];
  total: number;
}

export interface IInternalChatParticipantState {
  role: EInternalChatConversationParticipantRole;
  unread_count: number;
  closed_at: string | null;
  last_read_message_id: string | null;
}

export interface IInternalChatConversationParticipantView extends IInternalChatUserNamePhoto {
  role: EInternalChatConversationParticipantRole;
  unread_count: number;
  closed_at: string | null;
}

export interface IInternalChatMarkConversationReadInput {
  conversationId: string;
  userId: string;
  lastReadMessageId?: string | null;
}

export interface IInternalChatUpdateConversationLastMessageInput {
  conversationId: string;
  lastMessageId: string;
  lastMessagePreview: string | null;
  lastMessageAt: string;
}

export interface IInternalChatApplyUnreadOnNewMessageInput {
  conversationId: string;
  senderUserId: string;
  messageId: string;
  messageDate: string;
}

export interface IInternalChatAddGroupMemberInput {
  accountId: string;
  conversationId: string;
  userId: string;
}

export interface IInternalChatUpdateGroupConversationInput {
  accountId: string;
  conversationId: string;
  name?: string;
  photo?: string | null;
}

export interface IInternalChatTransferGroupLeaderInput {
  conversationId: string;
  userId: string;
}
