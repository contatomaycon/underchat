import type { MessageHeader } from 'node-rdkafka';
import type {
  KafkaClient,
  KafkaConsumerStartPosition,
} from '@core/plugins/kafkaStreams';

export interface KafkaRunnerMessage {
  value: Buffer | null;
  key?: Buffer | string | null;
  headers?: MessageHeader[];
  topic?: string;
  partition: number;
  offset: number;
  timestamp?: number;
  consumerAssignmentEpoch?: number;
}

export interface KafkaConsumerRunnerContext<TPayload> {
  topic: string;
  groupId: string;
  message: KafkaRunnerMessage;
  partition: number;
  offset: number;
  kafkaKey: string | null;
  entityKey: string;
  attempt: number;
  payload: TPayload;
  isActive: () => boolean;
  assertActive: () => void;
  /**
   * Renews the managed consumer watchdog only after a durable unit of work
   * completed. This is intentionally an explicit progress signal rather than
   * a periodic heartbeat: a hung handler must still be recovered.
   *
   * The call is fenced by the record assignment epoch and throws when the
   * record is no longer owned by this consumer generation.
   */
  reportProgress?: () => void;
}

export interface KafkaConsumerEffectLease {
  assertOwned: () => void;
  release: () => Promise<boolean | void>;
}

export interface KafkaConsumerRunnerLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export type KafkaConsumerRunnerErrorDecision = 'retryable' | 'terminal';

export type KafkaConsumerEffectLeaseRejectionDecision = 'retry' | 'terminal';

export type KafkaConsumerEffectLeaseFailureRecoveryDecision =
  'retry' | 'durable_handoff';

export type KafkaConsumerRunnerDiscardReason =
  'invalid_payload' | 'terminal_error' | 'retry_exhausted';

export interface KafkaConsumerRunnerOptions<TPayload> {
  kafka: KafkaClient;
  topic: string;
  groupId: string;
  startPosition?: KafkaConsumerStartPosition;
  requireDispatchAuthorization?: boolean;
  parse: (message: KafkaRunnerMessage) => TPayload | null;
  handle: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ) => Promise<void>;
  acquireEffectLease?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ) => Promise<KafkaConsumerEffectLease | null>;
  /**
   * Classifies a null lease result. Omitted/`retry` and thrown errors leave the
   * offset uncommitted and redrive it. Return `terminal` only after an
   * authoritative check proves the payload belongs to a stale runtime.
   */
  classifyEffectLeaseRejection?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ) =>
    | KafkaConsumerEffectLeaseRejectionDecision
    | Promise<KafkaConsumerEffectLeaseRejectionDecision>;
  /**
   * Optionally transfers responsibility for a retryable lease-acquisition
   * failure to another durable, fenced store. Return `durable_handoff` only
   * after that store has authoritatively accepted the payload; the runner then
   * commits the original Kafka offset. A thrown error is always fail-closed
   * and leaves the offset uncommitted.
   */
  recoverEffectLeaseAcquisitionFailure?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ) =>
    | KafkaConsumerEffectLeaseFailureRecoveryDecision
    | Promise<KafkaConsumerEffectLeaseFailureRecoveryDecision>;
  resolveEntityKey?: (
    payload: TPayload,
    message: KafkaRunnerMessage
  ) => string | null;
  /**
   * Optionally coalesces semantically duplicate records while their primary
   * record is still in flight. Coalescing is scoped to the same partition and
   * assignment. A later duplicate is marked complete locally, but contiguous
   * offset tracking keeps its Kafka commit behind the unfinished primary so a
   * crash still redelivers both records.
   */
  resolveCoalesceKey?: (
    payload: TPayload,
    message: KafkaRunnerMessage
  ) => string | null;
  preserveEntityOrder?: boolean;
  maxInFlightTotal?: number;
  maxInFlightPerPartition?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
  processingTimeoutMs?: number;
  shutdownDrainTimeoutMs?: number;
  logger?: KafkaConsumerRunnerLogger;
  onInvalidMessage?: (message: KafkaRunnerMessage) => Promise<void> | void;
  failOnInvalidMessageHookError?: boolean;
  onProcessed?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ) => Promise<void> | void;
  onFailed?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ) => Promise<void> | void;
  classifyError?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ) => KafkaConsumerRunnerErrorDecision;
  shouldContinueRetryWithoutCommit?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ) => boolean;
  onDiscarded?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown,
    reason: KafkaConsumerRunnerDiscardReason
  ) => Promise<void> | void;
  failOnDiscardedHookError?: boolean;
}
