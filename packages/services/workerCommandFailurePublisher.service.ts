import { createHash } from 'node:crypto';
import { singleton } from 'tsyringe';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, type JetStreamClient } from '@nats-io/jetstream';
import {
  WORKER_COMMAND_MAX_BYTES,
  WORKER_FAILURE_STREAM,
  WORKER_FAILURE_SUBJECT_PREFIX,
} from '@core/common/constants/workerCommandTransport';
import type { WorkerCommandEnvelopeV1 } from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  natsJetStreamPublisherOptionsFromEnvironment,
  natsNodeConnectionOptions,
} from '@core/services/natsJetStreamPublisher.service';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

export type WorkerCommandFailureCode =
  | 'invalid_envelope'
  | 'invalid_subject'
  | 'invalid_target'
  | 'expired'
  | 'epoch_rejected'
  | 'dead_letter'
  | 'ambiguous'
  | 'failed';

export type WorkerCommandFailureIdentity = Pick<
  WorkerCommandEnvelopeV1,
  | 'command_id'
  | 'operation_id'
  | 'account_id'
  | 'worker_id'
  | 'command_type'
  | 'entity_key'
  | 'entity_sequence'
  | 'payload_digest'
>;

interface WorkerCommandFailureV1 {
  schema_version: 1;
  failure_id: string;
  command_id: string | null;
  operation_id: string | null;
  account_id: string | null;
  worker_id: string;
  command_type: string | null;
  entity_key: string | null;
  entity_sequence: number | null;
  payload_digest: string | null;
  code: WorkerCommandFailureCode;
  error_name: string;
  error_code: string;
  failed_at: string;
}

/** Publishes bounded diagnostics only; command payloads never enter failures. */
@singleton()
export class WorkerCommandFailurePublisherService {
  private connection: NatsConnection | null = null;
  private client: JetStreamClient | null = null;

  public async publish(input: {
    workerId: string;
    code: WorkerCommandFailureCode;
    envelope?: WorkerCommandEnvelopeV1 | null;
    /** Payload-free identity used by deadline reconciliation. */
    command?: WorkerCommandFailureIdentity | null;
    deliveryIdentity?: string;
    rawPayloadDigest?: string;
    error: unknown;
  }): Promise<void> {
    const command = input.envelope ?? input.command;
    const identity =
      command?.command_id ??
      `${input.deliveryIdentity ?? 'unknown'}:${input.rawPayloadDigest ?? 'unknown'}`;
    const failureId = createHash('sha256')
      .update(
        `worker-command-failure-v1\0${input.workerId}\0${identity}\0${input.code}`
      )
      .digest('hex');
    const diagnostics = workerErrorDiagnostics(input.error);
    const failure: WorkerCommandFailureV1 = {
      schema_version: 1,
      failure_id: failureId,
      command_id: command?.command_id ?? null,
      operation_id: command?.operation_id ?? null,
      account_id: command?.account_id ?? null,
      worker_id: input.workerId,
      command_type: command?.command_type ?? null,
      entity_key: command?.entity_key ?? null,
      entity_sequence: command?.entity_sequence ?? null,
      payload_digest: command?.payload_digest ?? input.rawPayloadDigest ?? null,
      code: input.code,
      error_name: diagnostics.error_name,
      error_code: diagnostics.error_code,
      failed_at: new Date().toISOString(),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(failure));
    if (bytes.byteLength > WORKER_COMMAND_MAX_BYTES) {
      throw new Error('worker_command_failure_too_large');
    }
    const js = await this.jetStream();
    const ack = await js.publish(
      `${WORKER_FAILURE_SUBJECT_PREFIX}.${input.workerId}`,
      bytes,
      {
        msgID: failureId,
        expect: { streamName: WORKER_FAILURE_STREAM },
        timeout: 5_000,
        retries: 0,
      }
    );
    if (ack.stream !== WORKER_FAILURE_STREAM) {
      throw new Error('worker_command_failure_unexpected_stream');
    }
  }

  public async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.client = null;
    if (connection && !connection.isClosed()) await connection.drain();
  }

  private async jetStream(): Promise<JetStreamClient> {
    if (this.client && this.connection && !this.connection.isClosed()) {
      return this.client;
    }
    const options = natsJetStreamPublisherOptionsFromEnvironment();
    const connection = await connect(
      natsNodeConnectionOptions({
        ...options,
        connectionName: 'underchat-worker-command-failure-publisher',
      })
    );
    this.connection = connection;
    this.client = jetstream(connection, { timeout: 5_000 });
    return this.client;
  }
}
