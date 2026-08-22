import { EMessageType } from '../enums/EMessageType';
import { IContent } from './IChatMessage';

export type WhatsAppSourceProvider =
  'baileys' | 'wwebjs' | 'whatsmeow' | 'webhook' | 'official_whatsapp';

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
  /** Stable, provider-neutral identity of the physical inbound event. */
  event_id?: string;
  /** Stable provider revision for mutations when one is available. */
  event_revision?: string;
  integration_entitlement_revision?: string;
  worker_id: string;
  account_id: string;
  source_provider?: WhatsAppSourceProvider;
  /** Time at which UnderChat accepted the source event at its ingress. */
  source_received_at?: string;
  /** Logical worker runtime generation that emitted the event. */
  runtime_generation?: number | string;
  /** Individual provider connection/reconnection epoch that emitted the event. */
  connection_epoch?: string;
  /** Service-only retry lineage carried through durable MessageUpsert redrive. */
  consumer_redrive_attempt?: number;
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
