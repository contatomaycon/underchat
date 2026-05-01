import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';

export interface IInternalChatConversationBase {
  conversation_id: string;
  account_id: string;
  type: EInternalChatConversationType;
  name: string | null;
  photo: string | null;
  leader_user_id: string | null;
  last_message_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}
