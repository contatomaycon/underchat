import type { MessageSummaryPatch } from '@core/services/messageStatus.service';
import { WAMessageKey } from '@whiskeysockets/baileys';
import { WhatsAppSourceProvider } from './IUpsertMessage';

export interface IMessageStatusUpdate {
  /** Stable identity of the physical or logical status event. */
  event_id?: string;
  account_id: string;
  worker_id?: string;
  source_provider?: WhatsAppSourceProvider;
  runtime_generation?: number | string;
  connection_epoch?: string;
  message_id: string;
  /**
   * Stable Underchat message id when the status originates before a provider
   * id exists. Status consumers use it for the terminal mutation directly.
   */
  internal_message_id?: string;
  terminal_failure_schema?:
    | 'message_send_terminal_failure_recovery_v1'
    | 'message_send_ambiguous_terminal_v1';
  patch: MessageSummaryPatch;
  failed?: boolean;
  /** Definitive provider error returned by an official delivery receipt. */
  provider_error_code?: number;
  /** Original provider clock for diagnostics and deterministic projections. */
  provider_status_at?: string;
  /** Provider invocation may have succeeded, but no authoritative ACK exists. */
  ambiguous?: boolean;
  key?: WAMessageKey;
  retry_count?: number;
  first_seen_at?: number;
  parked_at?: number;
  /** Kafka assignment that created a durable retry; retries are not portable. */
  consumer_assignment_owner?: string;
  consumer_assignment_epoch?: number;
  consumer_partition?: number;
  /** Internal Redis retry version. Never produced to Kafka. */
  pending_retry_version?: string;
  /** Internal Redis claim token. Never produced to Kafka. */
  pending_claim_token?: string;
  /** Diagnostic owner of the internal Redis claim. Never produced to Kafka. */
  pending_claim_owner?: string;
}
