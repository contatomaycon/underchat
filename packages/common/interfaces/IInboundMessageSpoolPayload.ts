import { IUpsertMessage } from './IUpsertMessage';

export type InboundMessageSpoolProvider =
  'baileys' | 'wwebjs' | 'whatsmeow' | 'official_whatsapp';

export interface IInboundMessageSpoolPayload {
  provider: InboundMessageSpoolProvider;
  source_provider: InboundMessageSpoolProvider;
  account_id: string;
  worker_id: string;
  runtime_generation: string;
  connection_epoch: string;
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
  /** Immutable time at which this semantic event first entered parking. */
  first_parked_at?: string;
  kafka_topic?: string;
  kafka_key?: string | null;
  dedupe_key?: string;
  partition?: number;
  offset?: number;
  retry_count?: number;
  next_attempt_at?: number;
  error?: string;
  upsert?: IUpsertMessage | null;
  raw_payload?: string | null;
  raw_meta?: Record<string, unknown>;
  /** Final bounded-redrive disposition retained in the consumer DLT. */
  terminal_reason?: 'permanent' | 'max_attempts' | 'max_age';
  terminalized_at?: string;
}

export type InboundMessageParkingRedriveDisposition =
  'published' | 'discarded' | 'ignored';

export type InboundMessageParkingRedrivePublisher = (
  payload: IInboundMessageParkingPayload
) => Promise<InboundMessageParkingRedriveDisposition>;
