import { WAMessage } from '@whiskeysockets/baileys';
import { EMessageType } from '../enums/EMessageType';

export interface IUpsertMessage {
  worker_id: string;
  account_id: string;
  type: EMessageType;
  message: WAMessage;
  photo?: string | null;
  has_quoted: boolean;
  is_call_event?: boolean;
  call_phone?: string;
  call_jid?: string | null;
  call_jid_alt?: string | null;
  call_name?: string | null;
  webhook_message_type?: 'message' | 'chatbot';
}
