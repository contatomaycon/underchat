import { EMessageType } from '../enums/EMessageType';
import { IContent } from './IChatMessage';

export interface IUpsertMessageKey {
  id?: string;
  remoteJid?: string;
  remoteJidAlt?: string;
  fromMe?: boolean;
  participant?: string;
  participantAlt?: string;
  isViewOnce?: boolean;
  addressingMode?: string;
}

export interface IUpsertMessageEnvelope {
  key: IUpsertMessageKey;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number;
  pushName?: string | null;
  verifiedBizName?: string | null;
  ack?: number;
  status?: number;
}

export interface IUpsertMessage {
  worker_id: string;
  account_id: string;
  type: EMessageType;
  message: IUpsertMessageEnvelope;
  content?: IContent | null;
  photo?: string | null;
  has_quoted: boolean;
  is_call_event?: boolean;
  call_phone?: string;
  call_jid?: string | null;
  call_jid_alt?: string | null;
  call_name?: string | null;
  webhook_message_type?: 'message' | 'chatbot';
  webhook_chatbot_id?: string;
  transfer_sector_id?: string;
  transfer_sector_user_id?: string;
  transfer_user_id?: string;
  from_history_sync?: boolean;
}
