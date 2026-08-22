import {
  ClosedConnectionError,
  ConnectionError,
  DrainingConnectionError,
  NoRespondersError,
  RequestError,
  TimeoutError,
  connect,
  type NatsConnection,
  type NodeConnectionOptions,
} from '@nats-io/transport-node';
import {
  jetstream,
  type JetStreamClient,
  type JetStreamOptions,
  type PubAck,
} from '@nats-io/jetstream';
import {
  WORKER_COMMAND_PUBACK_TIMEOUT_MS,
  WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS,
  WORKER_COMMAND_RETRY_DELAYS_MS,
  WORKER_COMMAND_STREAM,
} from '@core/common/constants/workerCommandTransport';
import {
  assertWorkerCommandPublishable,
  assertWorkerCommandPublishReceiptV1,
  assertWorkerCommandRetryable,
  serializeWorkerCommandEnvelopeV1,
  WorkerCommandContractError,
  workerCommandSubject,
} from '@core/common/functions/workerCommandEnvelope';
import type {
  WorkerCommandEnvelopeV1,
  WorkerCommandPublishReceiptV1,
} from '@core/common/interfaces/IWorkerCommandEnvelope';
import {
  workerCommandTelemetryStore,
  type WorkerCommandPublishOutcome,
} from '@core/services/workerCommandTelemetryStore';

const DEFAULT_CONNECTION_NAME = 'underchat-worker-command-publisher';
const NATS_CONNECT_TIMEOUT_MS = 5_000;
const NATS_RECONNECT_WAIT_MS = 250;
const NATS_MAX_RECONNECT_ATTEMPTS = 10;

export interface NatsJetStreamPublisherOptions {
  servers: readonly string[];
  user: string;
  password: string;
  tls?: boolean;
  connectionName?: string;
}

export interface NatsJetStreamPublisherDependencies {
  connect(options: NodeConnectionOptions): Promise<NatsConnection>;
  jetstream(
    connection: NatsConnection,
    options?: JetStreamOptions
  ): JetStreamClient;
  now(): number;
  sleep(delayMs: number): Promise<void>;
}

export type WorkerCommandPublishErrorCode =
  | 'publisher_closed'
  | 'transport_unavailable'
  | 'unexpected_stream'
  | 'invalid_puback';

interface WorkerCommandPublishErrorOptions extends ErrorOptions {
  operationId?: string;
  issuedAt?: string;
  expiresAt?: string;
  retryUntil?: string;
}

export class WorkerCommandPublishError extends Error {
  readonly operationId?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly retryUntil?: string;

  constructor(
    readonly code: WorkerCommandPublishErrorCode,
    readonly commandId: string,
    message: string,
    options?: WorkerCommandPublishErrorOptions
  ) {
    super(message, options);
    this.name = 'WorkerCommandPublishError';
    this.operationId = options?.operationId;
    this.issuedAt = options?.issuedAt;
    this.expiresAt = options?.expiresAt;
    this.retryUntil = options?.retryUntil;
  }
}

const DEFAULT_DEPENDENCIES: NatsJetStreamPublisherDependencies = {
  connect,
  jetstream,
  now: Date.now,
  sleep: (delayMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    }),
};

function trimmedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseBooleanEnvironment(
  value: string | undefined,
  name: string
): boolean | undefined {
  const normalized = trimmedOptional(value)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} deve ser true ou false`);
}

export function natsJetStreamPublisherOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NatsJetStreamPublisherOptions {
  const servers = (trimmedOptional(environment.NATS_URL) ?? '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  if (servers.length === 0) {
    throw new Error('NATS_URL e obrigatoria para o WorkerCommandBus');
  }

  const user = trimmedOptional(environment.NATS_USER);
  const password = trimmedOptional(environment.NATS_PASSWORD);
  if (
    trimmedOptional(environment.NATS_TOKEN) ||
    trimmedOptional(environment.NATS_CREDS_BASE64)
  ) {
    throw new Error(
      'NATS suporta apenas autenticacao por NATS_USER e NATS_PASSWORD'
    );
  }
  if (!user || !password) {
    throw new Error('NATS_USER e NATS_PASSWORD sao obrigatorias');
  }

  return {
    servers,
    user,
    password,
    ...(environment.NATS_TLS !== undefined
      ? { tls: parseBooleanEnvironment(environment.NATS_TLS, 'NATS_TLS') }
      : {}),
    connectionName:
      trimmedOptional(environment.NATS_CONNECTION_NAME) ??
      DEFAULT_CONNECTION_NAME,
  };
}

export function natsNodeConnectionOptions(
  options: NatsJetStreamPublisherOptions
): NodeConnectionOptions {
  if (!options.user.trim() || !options.password) {
    throw new Error('NATS_USER e NATS_PASSWORD sao obrigatorias');
  }
  return {
    servers: [...options.servers],
    name: options.connectionName ?? DEFAULT_CONNECTION_NAME,
    timeout: NATS_CONNECT_TIMEOUT_MS,
    reconnectTimeWait: NATS_RECONNECT_WAIT_MS,
    reconnectJitter: 100,
    reconnectJitterTLS: 250,
    maxReconnectAttempts: NATS_MAX_RECONNECT_ATTEMPTS,
    waitOnFirstConnect: false,
    user: options.user,
    pass: options.password,
    ...(options.tls === true
      ? { tls: {} }
      : options.tls === false
        ? { tls: null }
        : {}),
  };
}

function errorCause(error: unknown): unknown {
  if (error instanceof Error && 'cause' in error) return error.cause;
  return undefined;
}

function isRetryablePublishError(error: unknown): boolean {
  if (
    error instanceof TimeoutError ||
    error instanceof NoRespondersError ||
    error instanceof ConnectionError ||
    error instanceof ClosedConnectionError ||
    error instanceof DrainingConnectionError
  ) {
    return true;
  }

  if (error instanceof RequestError && error.isNoResponders()) return true;
  const cause = errorCause(error);
  return (
    cause !== undefined && cause !== error && isRetryablePublishError(cause)
  );
}

function assertPubAck(ack: PubAck, commandId: string): void {
  if (ack.stream !== WORKER_COMMAND_STREAM) {
    throw new WorkerCommandPublishError(
      'unexpected_stream',
      commandId,
      `PubAck recebido do stream ${ack.stream || '<vazio>'}`
    );
  }
  if (
    !Number.isSafeInteger(ack.seq) ||
    ack.seq < 1 ||
    typeof ack.duplicate !== 'boolean'
  ) {
    throw new WorkerCommandPublishError(
      'invalid_puback',
      commandId,
      'PubAck JetStream invalido'
    );
  }
}

export class NatsJetStreamPublisher {
  private connection: NatsConnection | null = null;
  private client: JetStreamClient | null = null;
  private connecting: Promise<JetStreamClient> | null = null;
  private closed = false;

  constructor(
    private readonly options: NatsJetStreamPublisherOptions,
    private readonly dependencies: NatsJetStreamPublisherDependencies = DEFAULT_DEPENDENCIES
  ) {
    if (options.servers.length === 0) {
      throw new Error('Ao menos um servidor NATS deve ser configurado');
    }
    if (!options.user.trim() || !options.password) {
      throw new Error('Usuario e senha NATS sao obrigatorios');
    }
  }

  static fromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    dependencies: NatsJetStreamPublisherDependencies = DEFAULT_DEPENDENCIES
  ): NatsJetStreamPublisher {
    return new NatsJetStreamPublisher(
      natsJetStreamPublisherOptionsFromEnvironment(environment),
      dependencies
    );
  }

  publishCommand(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1> {
    return this.publish(envelope, false);
  }

  retryCommand(
    envelope: WorkerCommandEnvelopeV1
  ): Promise<WorkerCommandPublishReceiptV1> {
    return this.publish(envelope, true);
  }

  private async publish(
    envelope: WorkerCommandEnvelopeV1,
    publicRetry: boolean
  ): Promise<WorkerCommandPublishReceiptV1> {
    const startedAt = this.dependencies.now();
    workerCommandTelemetryStore.recordPublishRequest(publicRetry);
    try {
      const receipt = await this.publishInternal(envelope, publicRetry);
      workerCommandTelemetryStore.recordPublishOutcome(
        envelope.command_type,
        receipt.duplicate ? 'duplicate' : 'accepted'
      );
      workerCommandTelemetryStore.recordPubAckLatency(
        this.dependencies.now() - startedAt
      );
      return receipt;
    } catch (error) {
      workerCommandTelemetryStore.recordPublishOutcome(
        envelope.command_type,
        this.telemetryOutcome(error)
      );
      throw error;
    }
  }

  private async publishInternal(
    envelope: WorkerCommandEnvelopeV1,
    publicRetry: boolean
  ): Promise<WorkerCommandPublishReceiptV1> {
    const issuedAt = Date.parse(envelope.issued_at);
    const deadlineAt = Date.parse(envelope.deadline_at);
    const retryUntil = Math.min(
      deadlineAt,
      issuedAt + WORKER_COMMAND_PUBLIC_RETRY_WINDOW_MS
    );
    if (this.closed) {
      throw new WorkerCommandPublishError(
        'publisher_closed',
        envelope.command_id,
        'Publisher JetStream encerrado',
        this.envelopeErrorOptions(envelope, retryUntil)
      );
    }

    const initialNow = this.dependencies.now();
    try {
      if (publicRetry) {
        assertWorkerCommandRetryable(envelope, initialNow);
      } else {
        assertWorkerCommandPublishable(envelope, initialNow);
      }
    } catch (error) {
      if (error instanceof WorkerCommandContractError) {
        throw this.withContractEnvelopeContext(error, envelope, retryUntil);
      }
      throw error;
    }
    const encoded = serializeWorkerCommandEnvelopeV1(envelope);
    const subject = workerCommandSubject(envelope.worker_id);

    let attempt = 0;
    while (true) {
      const now = this.dependencies.now();
      assertWorkerCommandPublishable(envelope, now);
      if (attempt > 0) assertWorkerCommandRetryable(envelope, now);

      try {
        const client = await this.getClient();
        const publishNow = this.dependencies.now();
        assertWorkerCommandPublishable(envelope, publishNow);
        if (attempt > 0 || publicRetry) {
          assertWorkerCommandRetryable(envelope, publishNow);
        }
        const timeout = Math.max(
          1,
          Math.min(WORKER_COMMAND_PUBACK_TIMEOUT_MS, deadlineAt - publishNow)
        );
        const ack = await client.publish(subject, encoded, {
          msgID: envelope.command_id,
          expect: { streamName: WORKER_COMMAND_STREAM },
          timeout,
          retries: 0,
        });
        assertPubAck(ack, envelope.command_id);
        const acceptedAt = new Date(this.dependencies.now()).toISOString();
        const receipt: WorkerCommandPublishReceiptV1 = {
          command_id: envelope.command_id,
          operation_id: envelope.operation_id,
          stream: ack.stream,
          stream_sequence: ack.seq,
          duplicate: ack.duplicate,
          accepted_at: acceptedAt,
          expires_at: envelope.deadline_at,
        };
        assertWorkerCommandPublishReceiptV1(receipt);
        return receipt;
      } catch (error) {
        if (error instanceof WorkerCommandContractError) {
          throw this.withContractEnvelopeContext(error, envelope, retryUntil);
        }
        if (error instanceof WorkerCommandPublishError) {
          throw this.withEnvelopeContext(error, envelope, retryUntil);
        }
        if (!isRetryablePublishError(error)) {
          throw new WorkerCommandPublishError(
            'transport_unavailable',
            envelope.command_id,
            'JetStream rejeitou o comando sem possibilidade de retry seguro',
            {
              cause: error,
              operationId: envelope.operation_id,
              issuedAt: envelope.issued_at,
              expiresAt: envelope.deadline_at,
              retryUntil: new Date(retryUntil).toISOString(),
            }
          );
        }

        this.clearClosedConnection();
        const delay = WORKER_COMMAND_RETRY_DELAYS_MS[attempt];
        if (
          delay === undefined ||
          this.dependencies.now() + delay > retryUntil
        ) {
          throw new WorkerCommandPublishError(
            'transport_unavailable',
            envelope.command_id,
            'JetStream indisponivel dentro da janela de retry de 2 minutos',
            {
              cause: error,
              operationId: envelope.operation_id,
              issuedAt: envelope.issued_at,
              expiresAt: envelope.deadline_at,
              retryUntil: new Date(retryUntil).toISOString(),
            }
          );
        }
        attempt += 1;
        workerCommandTelemetryStore.recordPublishTechnicalRetry();
        await this.dependencies.sleep(delay);
      }
    }
  }

  private telemetryOutcome(error: unknown): WorkerCommandPublishOutcome {
    if (error instanceof WorkerCommandContractError) return 'contract_rejected';
    if (!(error instanceof WorkerCommandPublishError)) return 'rejected';
    switch (error.code) {
      case 'transport_unavailable':
        return 'unknown';
      case 'publisher_closed':
        return 'publisher_closed';
      case 'unexpected_stream':
      case 'invalid_puback':
        return 'rejected';
    }
  }

  private envelopeErrorOptions(
    envelope: WorkerCommandEnvelopeV1,
    retryUntil: number,
    cause?: unknown
  ): WorkerCommandPublishErrorOptions {
    return {
      ...(cause === undefined ? {} : { cause }),
      operationId: envelope.operation_id,
      issuedAt: envelope.issued_at,
      expiresAt: envelope.deadline_at,
      retryUntil: new Date(retryUntil).toISOString(),
    };
  }

  private withEnvelopeContext(
    error: WorkerCommandPublishError,
    envelope: WorkerCommandEnvelopeV1,
    retryUntil: number
  ): WorkerCommandPublishError {
    return new WorkerCommandPublishError(
      error.code,
      envelope.command_id,
      error.message,
      this.envelopeErrorOptions(envelope, retryUntil, error)
    );
  }

  private withContractEnvelopeContext(
    error: WorkerCommandContractError,
    envelope: WorkerCommandEnvelopeV1,
    retryUntil: number
  ): WorkerCommandContractError {
    error.operationId = envelope.operation_id;
    error.commandId = envelope.command_id;
    error.issuedAt = envelope.issued_at;
    error.expiresAt = envelope.deadline_at;
    error.retryUntil = new Date(retryUntil).toISOString();
    return error;
  }

  private async getClient(): Promise<JetStreamClient> {
    if (this.closed) {
      throw new WorkerCommandPublishError(
        'publisher_closed',
        '<connection>',
        'Publisher JetStream encerrado'
      );
    }
    if (this.client && this.connection && !this.connection.isClosed()) {
      return this.client;
    }
    if (this.connecting) return this.connecting;

    const connecting = this.dependencies
      .connect(natsNodeConnectionOptions(this.options))
      .then((connection) => {
        if (this.closed) {
          void connection.close();
          throw new WorkerCommandPublishError(
            'publisher_closed',
            '<connection>',
            'Publisher encerrado durante a conexao'
          );
        }
        const client = this.dependencies.jetstream(connection, {
          timeout: WORKER_COMMAND_PUBACK_TIMEOUT_MS,
        });
        this.connection = connection;
        this.client = client;
        void connection.closed().then(() => {
          if (this.connection === connection) {
            this.connection = null;
            this.client = null;
          }
        });
        return client;
      })
      .finally(() => {
        if (this.connecting === connecting) this.connecting = null;
      });
    this.connecting = connecting;
    return connecting;
  }

  private clearClosedConnection(): void {
    if (this.connection?.isClosed() || this.connection?.isDraining()) {
      this.connection = null;
      this.client = null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    let connection = this.connection;
    if (!connection && this.connecting) {
      try {
        await this.connecting;
        connection = this.connection;
      } catch {
        connection = null;
      }
    }
    this.connection = null;
    this.client = null;
    this.connecting = null;
    if (connection && !connection.isClosed()) await connection.drain();
  }
}
