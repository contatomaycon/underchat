import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { getErrorMessage } from '@core/common/functions/toError';

type RedisStreamValue = string | number;
type RedisStreamClient = Redis & {
  xadd(...args: RedisStreamValue[]): Promise<string | null>;
  xgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xreadgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xautoclaim(...args: RedisStreamValue[]): Promise<unknown>;
  xack(...args: RedisStreamValue[]): Promise<number>;
  xdel(...args: RedisStreamValue[]): Promise<number>;
  xpending(...args: RedisStreamValue[]): Promise<unknown>;
};
type RedisDeleteClient = Redis & {
  unlink?: (...keys: string[]) => Promise<number>;
};

export interface WorkerConnectionQrCodeRedisStateInvalidationOptions {
  accountId?: string;
  workerTypeId?: string;
  previousWorkerTypeId?: string;
  reason: string;
  recreateReason?: string;
  source?: string;
  runtimeGeneration?: number;
}

export interface WorkerConnectionQrCodeRedisStateInvalidationResult {
  deleted_keys: number;
  scanned_processed_keys: number;
  keys: string[];
  duration_ms?: number;
  group_destroy_count?: number;
  group_destroy_timeout_count?: number;
  scan_timeout_count?: number;
}

export interface WorkerConnectionQrCodeRedisStreamMessage {
  stream_key: string;
  stream_id: string;
  consumer_group: string;
  consumer_name: string;
  payload: IWorkerConnectionQrCodeQueueMessage | null;
  queue_latency_ms?: number;
  delivery_count?: number;
  reclaimed: boolean;
  invalid_payload?: boolean;
}

@injectable()
export class WorkerConnectionQrCodeRedisQueueService {
  static readonly STREAM_MAXLEN = 1000;
  static readonly READ_BLOCK_MS = 1000;
  static readonly READ_TIMEOUT_MS = Math.max(
    5_000,
    Math.min(
      60_000,
      Number(process.env.CONNECTION_QRCODE_REDIS_STREAM_READ_TIMEOUT_MS) ||
        10_000
    )
  );
  static readonly CLAIM_MIN_IDLE_MS = 3000;
  static readonly READ_COUNT = 10;
  static readonly PROCESSED_TTL_SECONDS = 300;
  static readonly INVALIDATE_SCAN_COUNT = Math.max(
    100,
    Math.min(
      5_000,
      Number(process.env.CONNECTION_QRCODE_REDIS_INVALIDATE_SCAN_COUNT) || 1000
    )
  );
  static readonly INVALIDATE_SCAN_TIMEOUT_MS = Math.max(
    500,
    Math.min(
      10_000,
      Number(process.env.CONNECTION_QRCODE_REDIS_INVALIDATE_SCAN_TIMEOUT_MS) ||
        2_000
    )
  );
  static readonly INVALIDATE_COMMAND_TIMEOUT_MS = Math.max(
    500,
    Math.min(
      10_000,
      Number(
        process.env.CONNECTION_QRCODE_REDIS_INVALIDATE_COMMAND_TIMEOUT_MS
      ) || 2_000
    )
  );
  static readonly SUPPORTED_WORKER_TYPES = [
    EWorkerType.baileys,
    EWorkerType.wwebjs,
    EWorkerType.whatsmeow,
  ] as const;

  private streamReadRedis: Redis | null = null;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  streamKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:requests`;
  }

  consumerGroup(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:group`;
  }

  consumerName(workerId: string, workerTypeId: string): string {
    return `${workerTypeId}:${workerId}:${process.pid}`;
  }

  processedAttemptKey(
    workerId: string,
    workerTypeId: string,
    connectionAttemptId: string
  ): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:processed:${connectionAttemptId}`;
  }

  activeAttemptKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`;
  }

  qrAttemptCacheKey(workerId: string, workerTypeId: string): string {
    return `connection:qrcode:${workerTypeId}:${workerId}:attempt`;
  }

  legacyStreamKey(workerId: string): string {
    return `connection:qrcode:${workerId}:requests`;
  }

  legacyConsumerGroup(workerId: string): string {
    return `connection:qrcode:${workerId}:group`;
  }

  legacyActiveAttemptKey(workerId: string): string {
    return `connection:qrcode:${workerId}:active_attempt`;
  }

  legacyQrAttemptCacheKey(workerId: string): string {
    return `connection:qrcode:${workerId}:attempt`;
  }

  async invalidateWorkerState(
    workerId: string,
    options: WorkerConnectionQrCodeRedisStateInvalidationOptions
  ): Promise<WorkerConnectionQrCodeRedisStateInvalidationResult> {
    const startedAt = Date.now();
    const workerTypes = this.workerTypesForInvalidation(options);
    const keys = new Set<string>([
      this.legacyStreamKey(workerId),
      this.legacyQrAttemptCacheKey(workerId),
      this.legacyActiveAttemptKey(workerId),
    ]);

    for (const workerTypeId of workerTypes) {
      keys.add(this.qrAttemptCacheKey(workerId, workerTypeId));
      keys.add(this.activeAttemptKey(workerId, workerTypeId));
      keys.add(this.streamKey(workerId, workerTypeId));
    }

    const groupDestroyResults = await Promise.all([
      this.destroyGroupByKeyWithTimeout(
        this.legacyStreamKey(workerId),
        this.legacyConsumerGroup(workerId)
      ),
      ...workerTypes.map((workerTypeId) =>
        this.destroyGroupIfPresent(workerId, workerTypeId)
      ),
    ]);
    const groupDestroyTimeoutCount = groupDestroyResults.filter(
      (result) => result.timedOut
    ).length;

    const [typedScan, legacyScan] = await Promise.all([
      this.scanKeysWithTimeout(`connection:qrcode:*:${workerId}:processed:*`),
      this.scanKeysWithTimeout(`connection:qrcode:${workerId}:processed:*`),
    ]);
    const typedProcessedKeys = typedScan.keys;
    const legacyProcessedKeys = legacyScan.keys;
    const processedKeys = [...typedProcessedKeys, ...legacyProcessedKeys];
    for (const key of processedKeys) {
      keys.add(key);
    }
    const scanTimeoutCount =
      Number(typedScan.timedOut) + Number(legacyScan.timedOut);

    const keyList = [...keys];
    const deletedKeys = keyList.length
      ? await this.deleteKeysWithTimeout(keyList)
      : 0;

    return {
      deleted_keys: deletedKeys,
      scanned_processed_keys: processedKeys.length,
      keys: keyList,
      duration_ms: Date.now() - startedAt,
      group_destroy_count: groupDestroyResults.length,
      group_destroy_timeout_count: groupDestroyTimeoutCount,
      scan_timeout_count: scanTimeoutCount,
    };
  }

  async enqueue(payload: IWorkerConnectionQrCodeQueueMessage): Promise<string> {
    const streamKey = this.streamKey(payload.worker_id, payload.worker_type_id);
    const fields = this.payloadToFields(payload);
    const streamId = await this.client().xadd(
      streamKey,
      'MAXLEN',
      '~',
      WorkerConnectionQrCodeRedisQueueService.STREAM_MAXLEN,
      '*',
      ...fields
    );

    if (!streamId) {
      throw new Error('Redis stream XADD did not return a stream id');
    }

    return streamId;
  }

  async ensureGroup(workerId: string, workerTypeId: string): Promise<void> {
    const streamKey = this.streamKey(workerId, workerTypeId);
    const consumerGroup = this.consumerGroup(workerId, workerTypeId);

    try {
      await this.client().xgroup(
        'CREATE',
        streamKey,
        consumerGroup,
        '0',
        'MKSTREAM'
      );
    } catch (error) {
      if (getErrorMessage(error).includes('BUSYGROUP')) {
        return;
      }

      throw error;
    }
  }

  async readNew(
    workerId: string,
    workerTypeId: string,
    consumerName: string
  ): Promise<WorkerConnectionQrCodeRedisStreamMessage[]> {
    const streamKey = this.streamKey(workerId, workerTypeId);
    const consumerGroup = this.consumerGroup(workerId, workerTypeId);
    const response = await this.runStreamReadWithTimeout('XREADGROUP', () =>
      this.readClient().xreadgroup(
        'GROUP',
        consumerGroup,
        consumerName,
        'COUNT',
        WorkerConnectionQrCodeRedisQueueService.READ_COUNT,
        'BLOCK',
        WorkerConnectionQrCodeRedisQueueService.READ_BLOCK_MS,
        'STREAMS',
        streamKey,
        '>'
      )
    );

    return this.parseReadResponse(response, {
      streamKey,
      consumerGroup,
      consumerName,
      reclaimed: false,
    });
  }

  async claimPending(
    workerId: string,
    workerTypeId: string,
    consumerName: string
  ): Promise<WorkerConnectionQrCodeRedisStreamMessage[]> {
    const streamKey = this.streamKey(workerId, workerTypeId);
    const consumerGroup = this.consumerGroup(workerId, workerTypeId);
    const response = await this.runStreamReadWithTimeout('XAUTOCLAIM', () =>
      this.readClient().xautoclaim(
        streamKey,
        consumerGroup,
        consumerName,
        WorkerConnectionQrCodeRedisQueueService.CLAIM_MIN_IDLE_MS,
        '0-0',
        'COUNT',
        WorkerConnectionQrCodeRedisQueueService.READ_COUNT
      )
    );

    return this.parseAutoClaimResponse(response, {
      streamKey,
      consumerGroup,
      consumerName,
      reclaimed: true,
    });
  }

  async ackAndDelete(
    workerId: string,
    workerTypeId: string,
    streamId: string
  ): Promise<{ acked: number; deleted: number }> {
    const streamKey = this.streamKey(workerId, workerTypeId);
    const consumerGroup = this.consumerGroup(workerId, workerTypeId);
    const [acked, deleted] = await Promise.all([
      this.client().xack(streamKey, consumerGroup, streamId),
      this.client().xdel(streamKey, streamId),
    ]);

    return { acked, deleted };
  }

  async markProcessed(
    payload: IWorkerConnectionQrCodeQueueMessage
  ): Promise<void> {
    await this.redis.set(
      this.processedAttemptKey(
        payload.worker_id,
        payload.worker_type_id,
        payload.connection_attempt_id
      ),
      '1',
      'EX',
      WorkerConnectionQrCodeRedisQueueService.PROCESSED_TTL_SECONDS
    );
  }

  async getDeliveryCount(
    workerId: string,
    workerTypeId: string,
    streamId: string
  ): Promise<number | undefined> {
    try {
      const response = await this.client().xpending(
        this.streamKey(workerId, workerTypeId),
        this.consumerGroup(workerId, workerTypeId),
        streamId,
        streamId,
        1
      );
      const rows = Array.isArray(response) ? response : [];
      const row = rows[0];
      if (!Array.isArray(row)) {
        return undefined;
      }

      const parsed = Number(row[3]);
      return Number.isFinite(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private client(): RedisStreamClient {
    return this.redis as RedisStreamClient;
  }

  private readClient(): RedisStreamClient {
    if (
      this.streamReadRedis &&
      this.streamReadRedis.status !== 'end' &&
      this.streamReadRedis.status !== 'close'
    ) {
      return this.streamReadRedis as RedisStreamClient;
    }

    this.streamReadRedis = this.redis.duplicate();
    return this.streamReadRedis as RedisStreamClient;
  }

  private resetReadClient(): void {
    const client = this.streamReadRedis;
    this.streamReadRedis = null;
    if (!client) {
      return;
    }

    client.disconnect(false);
  }

  private runStreamReadWithTimeout<T>(
    operation: string,
    action: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        this.resetReadClient();
        fail(
          new Error(
            `Redis Stream ${operation} timeout after ${WorkerConnectionQrCodeRedisQueueService.READ_TIMEOUT_MS}ms`
          )
        );
      }, WorkerConnectionQrCodeRedisQueueService.READ_TIMEOUT_MS);

      const finish = (): boolean => {
        if (settled) {
          return false;
        }
        settled = true;
        clearTimeout(timeout);
        return true;
      };

      const succeed = (value: T): void => {
        if (finish()) {
          resolve(value);
        }
      };

      const fail = (error: unknown): void => {
        if (finish()) {
          reject(error);
        }
      };

      try {
        action().then(succeed, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  private payloadToFields(
    payload: IWorkerConnectionQrCodeQueueMessage
  ): RedisStreamValue[] {
    const fields: RedisStreamValue[] = [
      'request_id',
      payload.request_id,
      'connection_attempt_id',
      payload.connection_attempt_id,
      'worker_id',
      payload.worker_id,
      'account_id',
      payload.account_id,
      'worker_type_id',
      payload.worker_type_id,
      'source',
      payload.source,
      'requested_at',
      payload.requested_at,
    ];

    if (payload.runtime_generation !== undefined) {
      fields.push('runtime_generation', payload.runtime_generation);
    }

    if (payload.expires_at) {
      fields.push('expires_at', payload.expires_at);
    }

    return fields;
  }

  private parseReadResponse(
    response: unknown,
    context: {
      streamKey: string;
      consumerGroup: string;
      consumerName: string;
      reclaimed: boolean;
    }
  ): WorkerConnectionQrCodeRedisStreamMessage[] {
    if (!Array.isArray(response)) {
      return [];
    }

    const messages: WorkerConnectionQrCodeRedisStreamMessage[] = [];
    for (const streamEntry of response) {
      if (!Array.isArray(streamEntry)) {
        continue;
      }

      const records = streamEntry[1];
      if (!Array.isArray(records)) {
        continue;
      }

      for (const record of records) {
        const message = this.parseRecord(record, context);
        if (message) {
          messages.push(message);
        }
      }
    }

    return messages;
  }

  private parseAutoClaimResponse(
    response: unknown,
    context: {
      streamKey: string;
      consumerGroup: string;
      consumerName: string;
      reclaimed: boolean;
    }
  ): WorkerConnectionQrCodeRedisStreamMessage[] {
    if (!Array.isArray(response)) {
      return [];
    }

    const records = response[1];
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .map((record) => this.parseRecord(record, context))
      .filter((message): message is WorkerConnectionQrCodeRedisStreamMessage =>
        Boolean(message)
      );
  }

  private parseRecord(
    record: unknown,
    context: {
      streamKey: string;
      consumerGroup: string;
      consumerName: string;
      reclaimed: boolean;
    }
  ): WorkerConnectionQrCodeRedisStreamMessage | null {
    if (!Array.isArray(record)) {
      return null;
    }

    const streamId = String(record[0] ?? '');
    const rawFields = record[1];
    if (!streamId || !Array.isArray(rawFields)) {
      return null;
    }

    const fields = this.fieldsToObject(rawFields);
    const payload = this.fieldsToPayload(fields);
    if (!payload) {
      return {
        stream_key: context.streamKey,
        stream_id: streamId,
        consumer_group: context.consumerGroup,
        consumer_name: context.consumerName,
        payload: null,
        reclaimed: context.reclaimed,
        invalid_payload: true,
      };
    }

    return {
      stream_key: context.streamKey,
      stream_id: streamId,
      consumer_group: context.consumerGroup,
      consumer_name: context.consumerName,
      payload,
      queue_latency_ms: this.queueLatencyMs(payload.requested_at),
      reclaimed: context.reclaimed,
    };
  }

  private fieldsToObject(rawFields: unknown[]): Record<string, string> {
    const fields: Record<string, string> = {};
    for (let index = 0; index < rawFields.length; index += 2) {
      const key = rawFields[index];
      const value = rawFields[index + 1];
      if (key !== undefined && value !== undefined) {
        fields[String(key)] = String(value);
      }
    }
    return fields;
  }

  private fieldsToPayload(
    fields: Record<string, string>
  ): IWorkerConnectionQrCodeQueueMessage | null {
    const payload = {
      request_id: fields.request_id,
      connection_attempt_id: fields.connection_attempt_id,
      worker_id: fields.worker_id,
      account_id: fields.account_id,
      worker_type_id: fields.worker_type_id,
      runtime_generation: this.optionalNumber(fields.runtime_generation),
      source: fields.source,
      requested_at: fields.requested_at,
      expires_at: fields.expires_at,
    };

    if (
      !payload.request_id ||
      !payload.connection_attempt_id ||
      !payload.worker_id ||
      !payload.account_id ||
      !payload.worker_type_id ||
      (payload.source !== 'manager' && payload.source !== 'external') ||
      !payload.requested_at
    ) {
      return null;
    }

    return payload as IWorkerConnectionQrCodeQueueMessage;
  }

  private workerTypesForInvalidation(
    options: WorkerConnectionQrCodeRedisStateInvalidationOptions
  ): string[] {
    return [
      ...new Set(
        [
          ...WorkerConnectionQrCodeRedisQueueService.SUPPORTED_WORKER_TYPES,
          options.workerTypeId,
          options.previousWorkerTypeId,
        ].filter((value): value is string => Boolean(value))
      ),
    ];
  }

  private async destroyGroupIfPresent(
    workerId: string,
    workerTypeId: string
  ): Promise<{ timedOut: boolean }> {
    const streamKey = this.streamKey(workerId, workerTypeId);
    const consumerGroup = this.consumerGroup(workerId, workerTypeId);

    return this.destroyGroupByKeyWithTimeout(streamKey, consumerGroup);
  }

  private async destroyGroupByKeyWithTimeout(
    streamKey: string,
    consumerGroup: string
  ): Promise<{ timedOut: boolean }> {
    try {
      await this.withTimeout(
        () => this.destroyGroupByKey(streamKey, consumerGroup),
        WorkerConnectionQrCodeRedisQueueService.INVALIDATE_COMMAND_TIMEOUT_MS
      );
      return { timedOut: false };
    } catch {
      return { timedOut: true };
    }
  }

  private async destroyGroupByKey(
    streamKey: string,
    consumerGroup: string
  ): Promise<void> {
    try {
      await this.client().xgroup('DESTROY', streamKey, consumerGroup);
    } catch {}
  }

  private async scanKeysWithTimeout(
    match: string
  ): Promise<{ keys: string[]; timedOut: boolean }> {
    try {
      const keys = await this.withTimeout(
        () => this.scanKeys(match),
        WorkerConnectionQrCodeRedisQueueService.INVALIDATE_SCAN_TIMEOUT_MS
      );
      return { keys, timedOut: false };
    } catch {
      return { keys: [], timedOut: true };
    }
  }

  private async scanKeys(match: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const response = await this.redis.scan(
        cursor,
        'MATCH',
        match,
        'COUNT',
        WorkerConnectionQrCodeRedisQueueService.INVALIDATE_SCAN_COUNT
      );
      cursor = String(response[0]);
      const batch = Array.isArray(response[1]) ? response[1] : [];
      for (const key of batch) {
        keys.push(String(key));
      }
    } while (cursor !== '0');

    return keys;
  }

  private async deleteKeysWithTimeout(keys: string[]): Promise<number> {
    try {
      return await this.withTimeout(
        () => this.deleteKeys(keys),
        WorkerConnectionQrCodeRedisQueueService.INVALIDATE_COMMAND_TIMEOUT_MS
      );
    } catch {
      return 0;
    }
  }

  private async deleteKeys(keys: string[]): Promise<number> {
    const redis = this.redis as RedisDeleteClient;
    if (typeof redis.unlink === 'function') {
      return redis.unlink(...keys);
    }

    return this.redis.del(...keys);
  }

  private withTimeout<T>(
    action: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Redis operation timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const finish = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      try {
        action().then(
          (value) => finish(() => resolve(value)),
          (error) => finish(() => reject(error))
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }

  private optionalNumber(value: string | undefined): number | undefined {
    if (value === undefined || !value.trim()) {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private queueLatencyMs(requestedAt: string): number | undefined {
    const requestedAtMs = Date.parse(requestedAt);
    if (!Number.isFinite(requestedAtMs)) {
      return undefined;
    }

    return Math.max(0, Date.now() - requestedAtMs);
  }
}
