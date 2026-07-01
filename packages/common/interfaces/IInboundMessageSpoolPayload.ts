import { IUpsertMessage } from './IUpsertMessage';

export type InboundMessageSpoolProvider =
  'baileys' | 'wwebjs' | 'whatsmeow' | 'official_whatsapp';

export interface IInboundMessageSpoolPayload {
  provider: InboundMessageSpoolProvider;
  account_id: string;
  worker_id: string;
  event_source: string;
  dedupe_key: string;
  kafka_topic: string;
  kafka_key: string;
  upsert: IUpsertMessage;
  raw_meta?: Record<string, unknown>;
  received_at: string;
  attempts: number;
  next_attempt_at?: number;
  last_error?: string;
}

export interface IInboundMessageParkingPayload {
  provider: InboundMessageSpoolProvider | 'message_upsert_consumer';
  account_id?: string;
  worker_id?: string;
  event_source: string;
  reason: string;
  stage: string;
  parked_at: string;
  kafka_topic?: string;
  kafka_key?: string | null;
  partition?: number;
  offset?: number;
  retry_count?: number;
  error?: string;
  upsert?: IUpsertMessage | null;
  raw_payload?: string | null;
  raw_meta?: Record<string, unknown>;
}
