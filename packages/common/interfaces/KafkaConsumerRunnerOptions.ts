import type { MessageHeader } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';

export interface KafkaRunnerMessage {
  value: Buffer | null;
  key?: Buffer | string | null;
  headers?: MessageHeader[];
  topic?: string;
  partition: number;
  offset: number;
  timestamp?: number;
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
}

export interface KafkaConsumerRunnerLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export type KafkaConsumerRunnerErrorDecision = 'retryable' | 'terminal';

export type KafkaConsumerRunnerDiscardReason =
  | 'invalid_payload'
  | 'terminal_error'
  | 'retry_exhausted';

export interface KafkaConsumerRunnerOptions<TPayload> {
  kafka: KafkaClient;
  topic: string;
  groupId: string;
  parse: (message: KafkaRunnerMessage) => TPayload | null;
  handle: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ) => Promise<void>;
  resolveEntityKey?: (
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
  onDiscarded?: (
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown,
    reason: KafkaConsumerRunnerDiscardReason
  ) => Promise<void> | void;
}
