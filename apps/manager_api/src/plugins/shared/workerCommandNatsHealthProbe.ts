import {
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  StoreCompression,
  jetstreamManager,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  WORKER_COMMAND_DUPLICATE_WINDOW_MS,
  WORKER_COMMAND_MAX_AGE_MS,
  WORKER_COMMAND_MAX_BYTES,
  WORKER_COMMAND_STREAM,
  WORKER_COMMAND_STREAM_LIMITS,
  WORKER_COMMAND_SUBJECT_WILDCARD,
  WORKER_DEFERRED_READY_SUBJECT_WILDCARD,
  WORKER_DEFERRED_SCHEDULE_SUBJECT_WILDCARD,
  WORKER_DEFERRED_STREAM,
  WORKER_EPOCH_KV_BUCKET,
  WORKER_FAILURE_STREAM,
  WORKER_FAILURE_STREAM_LIMITS,
  WORKER_FAILURE_SUBJECT_WILDCARD,
} from '@core/common/constants/workerCommandTransport';
import {
  natsNodeConnectionOptions,
  type NatsJetStreamPublisherOptions,
} from '@core/services/natsJetStreamPublisher.service';
import { workerCommandControlPlaneOptionsFromEnvironment } from '@core/services/workerCommandJetStreamControlPlane.service';

const PROBE_TIMEOUT_MS = 5_000;
const EPOCH_STREAM = `KV_${WORKER_EPOCH_KV_BUCKET}`;

export const WORKER_COMMAND_NATS_CONTRACTS = [
  'commands',
  'deferred',
  'failures',
  'epoch',
] as const;

export type WorkerCommandNatsContract =
  (typeof WORKER_COMMAND_NATS_CONTRACTS)[number];

export interface WorkerCommandNatsProbeResult {
  connected: true;
  contract_valid: true;
  contracts: WorkerCommandNatsContract[];
  checked_at: string;
}

export interface WorkerCommandNatsHealthProbeDependencies {
  options(): NatsJetStreamPublisherOptions;
  connect(
    options: ReturnType<typeof natsNodeConnectionOptions>
  ): Promise<NatsConnection>;
  manager(connection: NatsConnection): Promise<JetStreamManager>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: WorkerCommandNatsHealthProbeDependencies = {
  options: workerCommandControlPlaneOptionsFromEnvironment,
  connect,
  manager: (connection) =>
    jetstreamManager(connection, { timeout: PROBE_TIMEOUT_MS }),
  now: () => new Date(),
};

function hasExactSubjects(
  config: StreamConfig,
  expected: readonly string[]
): boolean {
  const actual = [...(config.subjects ?? [])].sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((subject, index) => subject === wanted[index])
  );
}

function assertCommandsContract(config: StreamConfig): void {
  if (
    config.name !== WORKER_COMMAND_STREAM ||
    !hasExactSubjects(config, [WORKER_COMMAND_SUBJECT_WILDCARD]) ||
    config.retention !== RetentionPolicy.Workqueue ||
    config.storage !== StorageType.File ||
    config.compression !== StoreCompression.S2 ||
    config.num_replicas !== WORKER_COMMAND_STREAM_LIMITS.replicas ||
    config.max_age !== WORKER_COMMAND_MAX_AGE_MS * 1_000_000 ||
    config.duplicate_window !==
      WORKER_COMMAND_DUPLICATE_WINDOW_MS * 1_000_000 ||
    config.max_msgs !== WORKER_COMMAND_STREAM_LIMITS.maxMessages ||
    config.max_bytes !== WORKER_COMMAND_STREAM_LIMITS.maxBytes ||
    config.max_msgs_per_subject !==
      WORKER_COMMAND_STREAM_LIMITS.maxMessagesPerSubject ||
    config.max_msg_size !== WORKER_COMMAND_MAX_BYTES ||
    config.discard !== DiscardPolicy.New ||
    config.discard_new_per_subject !== true ||
    config.deny_delete !== true ||
    config.deny_purge !== true
  ) {
    throw new Error('worker_command_commands_stream_contract_drift');
  }
}

function assertDeferredContract(config: StreamConfig): void {
  if (
    config.name !== WORKER_DEFERRED_STREAM ||
    !hasExactSubjects(config, [
      WORKER_DEFERRED_SCHEDULE_SUBJECT_WILDCARD,
      WORKER_DEFERRED_READY_SUBJECT_WILDCARD,
    ]) ||
    config.retention !== RetentionPolicy.Workqueue ||
    config.storage !== StorageType.File ||
    config.compression !== StoreCompression.S2 ||
    config.num_replicas !== 3 ||
    config.max_consumers !== 8 ||
    config.max_age !== WORKER_COMMAND_MAX_AGE_MS * 1_000_000 ||
    config.duplicate_window !==
      WORKER_COMMAND_DUPLICATE_WINDOW_MS * 1_000_000 ||
    config.max_msgs !== -1 ||
    config.max_bytes !== -1 ||
    config.max_msg_size !== WORKER_COMMAND_MAX_BYTES ||
    config.discard !== DiscardPolicy.Old ||
    config.deny_delete !== true ||
    config.deny_purge !== false ||
    config.allow_rollup_hdrs !== true ||
    config.allow_msg_ttl !== true ||
    config.allow_msg_schedules !== true
  ) {
    throw new Error('worker_command_deferred_stream_contract_drift');
  }
}

function assertFailuresContract(config: StreamConfig): void {
  if (
    config.name !== WORKER_FAILURE_STREAM ||
    !hasExactSubjects(config, [WORKER_FAILURE_SUBJECT_WILDCARD]) ||
    config.retention !== RetentionPolicy.Limits ||
    config.storage !== StorageType.File ||
    config.compression !== StoreCompression.S2 ||
    config.num_replicas !== WORKER_FAILURE_STREAM_LIMITS.replicas ||
    config.max_age !== WORKER_FAILURE_STREAM_LIMITS.maxAgeMs * 1_000_000 ||
    config.max_bytes !== WORKER_FAILURE_STREAM_LIMITS.maxBytes ||
    config.max_msg_size !== WORKER_COMMAND_MAX_BYTES ||
    config.discard !== DiscardPolicy.New ||
    config.deny_delete !== true ||
    config.deny_purge !== true
  ) {
    throw new Error('worker_command_failures_stream_contract_drift');
  }
}

function assertEpochContract(config: StreamConfig): void {
  if (
    config.name !== EPOCH_STREAM ||
    !hasExactSubjects(config, [`$KV.${WORKER_EPOCH_KV_BUCKET}.>`]) ||
    config.retention !== RetentionPolicy.Limits ||
    config.storage !== StorageType.File ||
    config.compression !== StoreCompression.S2 ||
    config.num_replicas !== 3 ||
    config.max_msgs_per_subject !== 1 ||
    config.max_age !== 0 ||
    config.max_bytes !== 64 * 1024 * 1024 ||
    config.max_msg_size !== 1024
  ) {
    throw new Error('worker_command_epoch_bucket_contract_drift');
  }
}

function streamName(contract: WorkerCommandNatsContract): string {
  switch (contract) {
    case 'commands':
      return WORKER_COMMAND_STREAM;
    case 'deferred':
      return WORKER_DEFERRED_STREAM;
    case 'failures':
      return WORKER_FAILURE_STREAM;
    case 'epoch':
      return EPOCH_STREAM;
  }
}

function assertContract(
  contract: WorkerCommandNatsContract,
  config: StreamConfig
): void {
  switch (contract) {
    case 'commands':
      assertCommandsContract(config);
      return;
    case 'deferred':
      assertDeferredContract(config);
      return;
    case 'failures':
      assertFailuresContract(config);
      return;
    case 'epoch':
      assertEpochContract(config);
  }
}

/**
 * Reuses one manager connection for background contract probes. HTTP health
 * reads only the process-local snapshot and never performs NATS I/O.
 */
export class WorkerCommandNatsHealthProbe {
  private connection: NatsConnection | null = null;
  private manager: JetStreamManager | null = null;
  private opening: Promise<JetStreamManager> | null = null;

  constructor(
    private readonly dependencies: WorkerCommandNatsHealthProbeDependencies = DEFAULT_DEPENDENCIES
  ) {}

  public async check(
    requestedContracts: readonly WorkerCommandNatsContract[]
  ): Promise<WorkerCommandNatsProbeResult> {
    const contracts = [...new Set(requestedContracts)].sort();
    const manager = await this.getManager();
    const infos = await Promise.all(
      contracts.map(async (contract) => ({
        contract,
        info: await manager.streams.info(streamName(contract)),
      }))
    );
    for (const { contract, info } of infos) {
      assertContract(contract, info.config);
    }
    if (!this.connection || this.connection.isClosed()) {
      throw new Error('worker_command_nats_probe_connection_closed');
    }
    return {
      connected: true,
      contract_valid: true,
      contracts,
      checked_at: this.dependencies.now().toISOString(),
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
      .connect(
        natsNodeConnectionOptions({
          ...this.dependencies.options(),
          connectionName: 'underchat-worker-command-health-probe',
        })
      )
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
}

export const workerCommandNatsHealthProbe = new WorkerCommandNatsHealthProbe();
