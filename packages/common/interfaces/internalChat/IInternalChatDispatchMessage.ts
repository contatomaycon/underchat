import { IInternalChatMessage } from './IInternalChatMessage';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';

export interface IInternalChatDispatchMessage {
  message: IInternalChatMessage;
  conversation_type: EInternalChatConversationType;
  sender_user_id: string;
}
