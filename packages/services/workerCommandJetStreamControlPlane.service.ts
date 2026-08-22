import {
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  jetstreamManager,
  type JetStreamManager,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/nats-core';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { inject, injectable, singleton } from 'tsyringe';
import {
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_SUBJECT_WILDCARD,
} from '@core/common/constants/workerCommandTransport';
import { workerCommandSubject } from '@core/common/functions/workerCommandEnvelope';
import {
  natsJetStreamPublisherOptionsFromEnvironment,
  natsNodeConnectionOptions,
  type NatsJetStreamPublisherOptions,
} from '@core/services/natsJetStreamPublisher.service';
import { workerCommandDurableName } from '@core/services/workerCommandJetStreamIngress.service';

const CONTROL_PLANE_TIMEOUT_MS = 5_000;

export interface WorkerCommandResourceDeletionResult {
  durable_name: string;
  durable_deleted: boolean;
  subject: string;
  backlog_disposition: 'expires_by_stream_max_age';
  backlog_max_age_ms: number;
  purge_performed: false;
}

interface WorkerCommandJetStreamControlPlaneDependencies {
  connect(): Promise<NatsConnection>;
  manager(connection: NatsConnection): Promise<JetStreamManager>;
}

export const WORKER_COMMAND_JETSTREAM_CONTROL_PLANE_DEPENDENCIES =
  'WorkerCommandJetStreamControlPlaneDependencies';

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/**
 * Manager-side credentials are deliberately separate from the credentials
 * inherited by channel containers. Runtime credentials cannot perform
 * lifecycle deletion; only the administrative control plane may delete a
 * durable consumer.
 */
export function workerCommandControlPlaneOptionsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NatsJetStreamPublisherOptions {
  // The control-plane process uses its own routable NATS_URL. The private
  // Docker alias is an infrastructure/bootstrap concern and is not assumed to
  // resolve from a manager running directly on the host.
  const servers =
    optional(environment.NATS_URL) ?? optional(environment.NATS_PRIVATE_URL);
  const adminUser = optional(environment.NATS_ADMIN_USER);
  const adminPassword = optional(environment.NATS_ADMIN_PASSWORD);
  if (!adminUser || !adminPassword) {
    throw new Error(
      'NATS_ADMIN_USER e NATS_ADMIN_PASSWORD sao obrigatorias no plano de controle'
    );
  }

  return natsJetStreamPublisherOptionsFromEnvironment({
    ...environment,
    NATS_URL: servers,
    NATS_USER: adminUser,
    NATS_PASSWORD: adminPassword,
    NATS_TOKEN: undefined,
    NATS_CREDS_BASE64: undefined,
    NATS_CONNECTION_NAME: 'underchat-worker-command-finalizer',
  });
}

@singleton()
@injectable()
export class WorkerCommandJetStreamControlPlaneService {
  private connection: NatsConnection | null = null;
  private manager: JetStreamManager | null = null;
  private opening: Promise<JetStreamManager> | null = null;
  private readonly dependencies: WorkerCommandJetStreamControlPlaneDependencies;

  constructor(
    @inject(WORKER_COMMAND_JETSTREAM_CONTROL_PLANE_DEPENDENCIES, {
      isOptional: true,
    })
    dependencies?: WorkerCommandJetStreamControlPlaneDependencies
  ) {
    this.dependencies = dependencies ?? {
      connect: async () =>
        connect(
          natsNodeConnectionOptions(
            workerCommandControlPlaneOptionsFromEnvironment()
          )
        ),
      manager: (connection) =>
        jetstreamManager(connection, { timeout: CONTROL_PLANE_TIMEOUT_MS }),
    };
  }

  public async deleteWorkerResources(
    workerId: string
  ): Promise<WorkerCommandResourceDeletionResult> {
    const manager = await this.getManager();
    const stream = await manager.streams.info(WORKER_COMMAND_STREAM);
    this.assertSafeExpirationContract(stream.config);

    const durableName = workerCommandDurableName(workerId);
    let durableDeleted = false;
    try {
      durableDeleted = await manager.consumers.delete(
        WORKER_COMMAND_STREAM,
        durableName
      );
    } catch (error) {
      if (!this.isMissingConsumer(error)) throw error;
    }

    return {
      durable_name: durableName,
      durable_deleted: durableDeleted,
      subject: workerCommandSubject(workerId),
      backlog_disposition: 'expires_by_stream_max_age',
      backlog_max_age_ms: WORKER_COMMAND_MAX_AGE_MS,
      purge_performed: false,
    };
  }

  public async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.manager = null;
    this.opening = null;
    if (connection && !connection.isClosed()) await connection.drain();
  }

  private async getManager(): Promise<JetStreamManager> {
    if (this.manager && this.connection && !this.connection.isClosed()) {
      return this.manager;
    }
    if (this.opening) return this.opening;

    const opening = this.dependencies
      .connect()
      .then(async (connection) => {
        const manager = await this.dependencies.manager(connection);
        this.connection = connection;
        this.manager = manager;
        void connection.closed().then(() => {
          if (this.connection === connection) {
            this.connection = null;
            this.manager = null;
          }
        });
        return manager;
      })
      .finally(() => {
        if (this.opening === opening) this.opening = null;
      });
    this.opening = opening;
    return opening;
  }

  private assertSafeExpirationContract(config: {
    retention: string;
    max_age: number;
    deny_purge: boolean;
    subjects?: string[];
  }): void {
    if (
      config.retention !== RetentionPolicy.Workqueue ||
      config.max_age !== nanos(WORKER_COMMAND_MAX_AGE_MS) ||
      config.deny_purge !== true ||
      !config.subjects?.includes(WORKER_COMMAND_SUBJECT_WILDCARD)
    ) {
      throw new Error('worker_command_stream_expiration_contract_drift');
    }
  }

  private isMissingConsumer(error: unknown): boolean {
    return (
      (error instanceof JetStreamApiError &&
        error.code === JetStreamApiCodes.ConsumerNotFound) ||
      (error instanceof Error && error.name === 'ConsumerNotFoundError')
    );
  }
}
