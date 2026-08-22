import { Kvm, type KV, type KvEntry } from '@nats-io/kv';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { injectable, singleton } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { WORKER_EPOCH_KV_BUCKET } from '@core/common/constants/workerCommandTransport';
import {
  natsJetStreamPublisherOptionsFromEnvironment,
  natsNodeConnectionOptions,
  type NatsJetStreamPublisherOptions,
} from '@core/services/natsJetStreamPublisher.service';

export type WorkerCommandEpochState = 'active' | 'draining' | 'closed';

export interface WorkerCommandEpochRecordV1 {
  schema_version: 1;
  worker_id: string;
  account_id: string;
  epoch: string;
  /**
   * Runtime-instance fence. This is deliberately distinct from `epoch`:
   * `epoch` belongs to the logical worker command queue and survives an
   * ordinary container recreate, while this value follows the session writer.
   * Optional only so binaries can migrate records written before the split.
   */
  runtime_writer_epoch?: string;
  runtime_generation: number;
  state: WorkerCommandEpochState;
  activated_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface WorkerCommandEpochSnapshot {
  record: WorkerCommandEpochRecordV1;
  revision: number;
}

export interface WorkerCommandEpochGuard {
  readonly epoch: string;
  assertActive(): void;
  close(): Promise<void>;
}

const MAX_EPOCH_VALUE_BYTES = 1024;
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIVATE_RUNTIME_CAS_ATTEMPTS = 4;

export class WorkerCommandEpochError extends Error {
  public readonly retryable: boolean;

  constructor(
    public readonly code:
      'unavailable' | 'missing' | 'invalid' | 'not_active' | 'conflict',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'WorkerCommandEpochError';
    this.retryable = code === 'unavailable' || code === 'conflict';
  }
}

@singleton()
@injectable()
export class WorkerCommandEpochService {
  private connection: NatsConnection | null = null;
  private bucket: KV | null = null;
  private opening: Promise<KV> | null = null;

  private readonly options: NatsJetStreamPublisherOptions;

  constructor() {
    this.options = natsJetStreamPublisherOptionsFromEnvironment();
  }

  public async requireActive(
    accountId: string,
    workerId: string
  ): Promise<WorkerCommandEpochSnapshot> {
    const snapshot = await this.get(workerId);
    if (!snapshot) {
      throw new WorkerCommandEpochError(
        'missing',
        `worker_command_epoch_missing:${workerId}`
      );
    }
    if (snapshot.record.account_id !== this.segment(accountId, 'account_id')) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_account_mismatch:${workerId}`
      );
    }
    if (snapshot.record.state !== 'active') {
      throw new WorkerCommandEpochError(
        'not_active',
        `worker_command_epoch_${snapshot.record.state}:${workerId}`
      );
    }
    return snapshot;
  }

  public async assertActive(
    accountId: string,
    workerId: string,
    expectedEpoch: string
  ): Promise<WorkerCommandEpochSnapshot> {
    const snapshot = await this.requireActive(accountId, workerId);
    if (snapshot.record.epoch !== expectedEpoch) {
      throw new WorkerCommandEpochError(
        'not_active',
        `worker_command_epoch_stale:${workerId}`
      );
    }
    return snapshot;
  }

  public async get(
    workerId: string
  ): Promise<WorkerCommandEpochSnapshot | null> {
    try {
      const entry = await (await this.openBucket()).get(this.key(workerId));
      if (!entry || entry.operation !== 'PUT') return null;
      return this.decode(entry);
    } catch (error) {
      if (error instanceof WorkerCommandEpochError) throw error;
      throw new WorkerCommandEpochError(
        'unavailable',
        `worker_command_epoch_unavailable:${workerId}`,
        { cause: error }
      );
    }
  }

  /**
   * Activates a concrete runtime without rotating the logical command epoch.
   *
   * The first runtime creates the logical UUID. Restarts of the same runtime
   * are idempotent and recreates with a newer generation only replace the
   * runtime-instance fence. Consequently, commands accepted before a recreate
   * keep the same `origin_epoch` and remain executable by the replacement.
   * Draining/closed epochs are never reopened by runtime startup.
   */
  public async activateRuntime(input: {
    accountId: string;
    workerId: string;
    runtimeWriterEpoch: string;
    runtimeGeneration: number;
    now?: Date;
  }): Promise<WorkerCommandEpochSnapshot> {
    const accountId = this.segment(input.accountId, 'account_id');
    const workerId = this.segment(input.workerId, 'worker_id');
    const runtimeWriterEpoch = this.segment(
      input.runtimeWriterEpoch,
      'runtime_writer_epoch',
      512
    );
    const runtimeGeneration = input.runtimeGeneration;
    if (!Number.isSafeInteger(runtimeGeneration) || runtimeGeneration < 1) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_runtime_generation_invalid:${workerId}`
      );
    }

    for (
      let attempt = 0;
      attempt < ACTIVATE_RUNTIME_CAS_ATTEMPTS;
      attempt += 1
    ) {
      const current = await this.get(workerId);
      const now = (input.now ?? new Date()).toISOString();
      let record: WorkerCommandEpochRecordV1;
      let expectedRevision: number | null;

      if (!current) {
        record = {
          schema_version: 1,
          worker_id: workerId,
          account_id: accountId,
          epoch: uuidv7(),
          runtime_writer_epoch: runtimeWriterEpoch,
          runtime_generation: runtimeGeneration,
          state: 'active',
          activated_at: now,
          updated_at: now,
          closed_at: null,
        };
        expectedRevision = null;
      } else {
        if (current.record.account_id !== accountId) {
          throw new WorkerCommandEpochError(
            'conflict',
            `worker_command_epoch_identity_conflict:${workerId}`
          );
        }
        if (current.record.state !== 'active') {
          throw new WorkerCommandEpochError(
            'not_active',
            `worker_command_epoch_${current.record.state}:${workerId}`
          );
        }
        if (runtimeGeneration < current.record.runtime_generation) {
          throw new WorkerCommandEpochError(
            'not_active',
            `worker_command_epoch_generation_stale:${workerId}`
          );
        }

        const currentRuntimeWriterEpoch = this.runtimeWriterEpoch(
          current.record
        );
        if (runtimeGeneration === current.record.runtime_generation) {
          if (currentRuntimeWriterEpoch !== runtimeWriterEpoch) {
            throw new WorkerCommandEpochError(
              'conflict',
              `worker_command_epoch_runtime_identity_conflict:${workerId}`
            );
          }
          if (current.record.runtime_writer_epoch === runtimeWriterEpoch) {
            return current;
          }
        }

        record = {
          ...current.record,
          // Preserve the logical epoch and its original activation time.
          runtime_writer_epoch: runtimeWriterEpoch,
          runtime_generation: runtimeGeneration,
          updated_at: now,
          closed_at: null,
        };
        expectedRevision = current.revision;
      }

      try {
        return await this.write(record, expectedRevision);
      } catch (error) {
        if (
          !(error instanceof WorkerCommandEpochError) ||
          error.code !== 'conflict' ||
          attempt + 1 >= ACTIVATE_RUNTIME_CAS_ATTEMPTS
        ) {
          throw error;
        }
      }
    }

    throw new WorkerCommandEpochError(
      'conflict',
      `worker_command_epoch_activation_conflict:${workerId}`
    );
  }

  public async assertRuntimeActive(
    accountId: string,
    workerId: string,
    expectedEpoch: string,
    expectedRuntimeGeneration: number,
    expectedRuntimeWriterEpoch: string
  ): Promise<WorkerCommandEpochSnapshot> {
    const snapshot = await this.assertActive(
      accountId,
      workerId,
      expectedEpoch
    );
    if (
      snapshot.record.runtime_generation !== expectedRuntimeGeneration ||
      this.runtimeWriterEpoch(snapshot.record) !== expectedRuntimeWriterEpoch
    ) {
      throw new WorkerCommandEpochError(
        'not_active',
        `worker_command_epoch_runtime_replaced:${workerId}`
      );
    }
    return snapshot;
  }

  /**
   * Maintains a synchronous fence for the provider boundary from a single KV
   * watch per worker. Handlers can check it immediately before invoking the
   * SDK without polling NATS once per message or making the hot call await an
   * extra network round-trip.
   */
  public async watchActive(
    accountId: string,
    workerId: string,
    expectedEpoch: string,
    expectedRuntimeGeneration: number,
    expectedRuntimeWriterEpoch: string
  ): Promise<WorkerCommandEpochGuard> {
    await this.assertRuntimeActive(
      accountId,
      workerId,
      expectedEpoch,
      expectedRuntimeGeneration,
      expectedRuntimeWriterEpoch
    );
    const watcher = await (
      await this.openBucket()
    ).watch({
      key: this.key(workerId),
    });
    let active = true;
    let rejection: WorkerCommandEpochError | null = null;
    const reject = (error: WorkerCommandEpochError): void => {
      active = false;
      rejection ??= error;
    };
    const observing = (async () => {
      try {
        for await (const entry of watcher) {
          if (entry.operation !== 'PUT') {
            reject(
              new WorkerCommandEpochError(
                'not_active',
                `worker_command_epoch_removed:${workerId}`
              )
            );
            continue;
          }
          const snapshot = this.decode(entry);
          if (
            snapshot.record.worker_id !== workerId ||
            snapshot.record.account_id !== accountId ||
            snapshot.record.epoch !== expectedEpoch ||
            snapshot.record.runtime_generation !== expectedRuntimeGeneration ||
            this.runtimeWriterEpoch(snapshot.record) !==
              expectedRuntimeWriterEpoch ||
            snapshot.record.state !== 'active'
          ) {
            reject(
              new WorkerCommandEpochError(
                'not_active',
                `worker_command_epoch_revoked:${workerId}`
              )
            );
          }
        }
      } catch (error) {
        reject(
          error instanceof WorkerCommandEpochError
            ? error
            : new WorkerCommandEpochError(
                'unavailable',
                `worker_command_epoch_watch_unavailable:${workerId}`,
                { cause: error }
              )
        );
      }
    })();

    return {
      epoch: expectedEpoch,
      assertActive: () => {
        if (!active) {
          throw (
            rejection ??
            new WorkerCommandEpochError(
              'not_active',
              `worker_command_epoch_revoked:${workerId}`
            )
          );
        }
      },
      close: async () => {
        active = false;
        watcher.stop();
        await observing;
      },
    };
  }

  public async transition(
    workerId: string,
    expectedEpoch: string,
    nextState: 'draining' | 'closed',
    now = new Date()
  ): Promise<WorkerCommandEpochSnapshot> {
    const current = await this.get(workerId);
    if (!current) {
      throw new WorkerCommandEpochError(
        'missing',
        `worker_command_epoch_missing:${workerId}`
      );
    }
    if (current.record.epoch !== expectedEpoch) {
      throw new WorkerCommandEpochError(
        'conflict',
        `worker_command_epoch_stale:${workerId}`
      );
    }
    if (current.record.state === 'closed') return current;
    if (current.record.state === 'draining' && nextState === 'draining') {
      return current;
    }
    const timestamp = now.toISOString();
    return this.write(
      {
        ...current.record,
        state: nextState,
        updated_at: timestamp,
        closed_at: nextState === 'closed' ? timestamp : null,
      },
      current.revision
    );
  }

  public async close(): Promise<void> {
    const connection = this.connection;
    this.bucket = null;
    this.opening = null;
    this.connection = null;
    if (connection && !connection.isClosed()) await connection.drain();
  }

  private async write(
    record: WorkerCommandEpochRecordV1,
    expectedRevision: number | null
  ): Promise<WorkerCommandEpochSnapshot> {
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload, 'utf8') > MAX_EPOCH_VALUE_BYTES) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_value_too_large:${record.worker_id}`
      );
    }
    try {
      const bucket = await this.openBucket();
      const revision =
        expectedRevision === null
          ? await bucket.create(this.key(record.worker_id), payload)
          : await bucket.update(
              this.key(record.worker_id),
              payload,
              expectedRevision
            );
      return { record, revision };
    } catch (error) {
      throw new WorkerCommandEpochError(
        'conflict',
        `worker_command_epoch_cas_failed:${record.worker_id}`,
        { cause: error }
      );
    }
  }

  private async openBucket(): Promise<KV> {
    if (this.bucket && this.connection && !this.connection.isClosed()) {
      return this.bucket;
    }
    if (this.opening) return this.opening;
    const opening = connect(natsNodeConnectionOptions(this.options))
      .then(async (connection) => {
        const bucket = await new Kvm(connection).open(WORKER_EPOCH_KV_BUCKET);
        await bucket.status();
        this.connection = connection;
        this.bucket = bucket;
        void connection.closed().then(() => {
          if (this.connection === connection) {
            this.connection = null;
            this.bucket = null;
          }
        });
        return bucket;
      })
      .finally(() => {
        if (this.opening === opening) this.opening = null;
      });
    this.opening = opening;
    return opening;
  }

  private decode(entry: KvEntry): WorkerCommandEpochSnapshot {
    if (entry.value.byteLength > MAX_EPOCH_VALUE_BYTES) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_value_too_large:${entry.key}`
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(entry.value));
    } catch (error) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_json_invalid:${entry.key}`,
        { cause: error }
      );
    }
    if (!this.isRecord(value)) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_record_invalid:${entry.key}`
      );
    }
    const state = value.state;
    if (
      value.schema_version !== 1 ||
      !SUBJECT_TOKEN.test(String(value.worker_id ?? '')) ||
      entry.key !== `worker.${String(value.worker_id ?? '')}` ||
      !this.isCanonicalSegment(value.account_id, 256) ||
      !this.isOpaqueEpoch(value.epoch) ||
      !(
        value.runtime_writer_epoch === undefined ||
        this.isOpaqueEpoch(value.runtime_writer_epoch)
      ) ||
      !Number.isSafeInteger(value.runtime_generation) ||
      Number(value.runtime_generation) < 1 ||
      !['active', 'draining', 'closed'].includes(String(state)) ||
      !this.isCanonicalTimestamp(value.activated_at) ||
      !this.isCanonicalTimestamp(value.updated_at) ||
      (state === 'closed'
        ? !this.isCanonicalTimestamp(value.closed_at)
        : value.closed_at !== null)
    ) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_record_invalid:${entry.key}`
      );
    }
    const record = value as unknown as WorkerCommandEpochRecordV1;
    return { record, revision: entry.revision };
  }

  private runtimeWriterEpoch(record: WorkerCommandEpochRecordV1): string {
    // Before the split, `epoch` was the session writer epoch. Treating it as
    // the runtime fence permits a rolling upgrade without reopening or rotating
    // the logical queue identity.
    return record.runtime_writer_epoch ?? record.epoch;
  }

  private isCanonicalSegment(value: unknown, max: number): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.trim() === value &&
      value.length <= max
    );
  }

  private isOpaqueEpoch(value: unknown): value is string {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.trim() !== value ||
      Buffer.byteLength(value, 'utf8') > 512
    ) {
      return false;
    }
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint < 0x20 || codePoint === 0x7f) return false;
    }
    return true;
  }

  private isCanonicalTimestamp(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const milliseconds = Date.parse(value);
    return (
      Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    );
  }

  private key(workerId: string): string {
    return `worker.${this.segment(workerId, 'worker_id')}`;
  }

  private segment(value: string, name: string, max = 256): string {
    const normalized = value?.trim();
    if (!normalized || normalized !== value || normalized.length > max) {
      throw new WorkerCommandEpochError(
        'invalid',
        `worker_command_epoch_${name}_invalid`
      );
    }
    if (name === 'worker_id' && !SUBJECT_TOKEN.test(normalized)) {
      throw new WorkerCommandEpochError(
        'invalid',
        'worker_command_epoch_worker_id_invalid'
      );
    }
    return normalized;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
