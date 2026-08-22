import type {
  WORKER_COMMAND_SCHEMA_VERSION,
  WORKER_COMMAND_TYPES,
} from '@core/common/constants/workerCommandTransport';

export type WorkerCommandType = (typeof WORKER_COMMAND_TYPES)[number];

export type WorkerCommandJsonPrimitive = string | number | boolean | null;

export type WorkerCommandJsonValue =
  | WorkerCommandJsonPrimitive
  | WorkerCommandJsonValue[]
  | WorkerCommandJsonObject;

export interface WorkerCommandJsonObject {
  [key: string]: WorkerCommandJsonValue;
}

export interface WorkerCommandEnvelopeV1 {
  schema_version: typeof WORKER_COMMAND_SCHEMA_VERSION;
  command_id: string;
  operation_id: string;
  retry_of: string | null;
  account_id: string;
  worker_id: string;
  command_type: WorkerCommandType;
  entity_key: string;
  entity_sequence: number;
  predecessor_operation_id: string | null;
  origin_epoch: string;
  issued_at: string;
  deadline_at: string;
  payload_version: number;
  payload_digest: string;
  payload: WorkerCommandJsonObject;
  traceparent: string | null;
  source: string;
}

export type BuildWorkerCommandEnvelopeV1Input = Omit<
  WorkerCommandEnvelopeV1,
  'schema_version' | 'payload_digest'
>;

export interface WorkerCommandPublishReceiptV1 {
  command_id: string;
  operation_id: string;
  stream: string;
  stream_sequence: number;
  duplicate: boolean;
  accepted_at: string;
  expires_at: string;
}
