import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';

export interface IInternalChatConversationParticipant {
  user_id: string;
  name: string;
  photo?: string | null;
  email?: string | null;
  sector?: string | null;
  position?: string | null;
  role: EInternalChatConversationParticipantRole;
  unread_count: number;
  closed_at?: string | null;
}

export interface IInternalChatConversation {
  conversation_id: string;
  account_id: string;
  type: EInternalChatConversationType;
  name?: string | null;
  photo?: string | null;
  leader_user_id?: string | null;
  last_message_id?: string | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  is_closed_for_me: boolean;
  unread_count: number;
  participants: IInternalChatConversationParticipant[];
  created_at: string;
  updated_at: string;
}
