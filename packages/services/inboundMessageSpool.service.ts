import { inject, singleton } from 'tsyringe';
import Redis from 'ioredis';
import {
  IInboundMessageParkingPayload,
  IInboundMessageSpoolPayload,
  InboundMessageSpoolProvider,
} from '@core/common/interfaces/IInboundMessageSpoolPayload';

type RedisStreamValue = string | number;
type RedisStreamClient = Redis & {
  xadd(...args: RedisStreamValue[]): Promise<string | null>;
  xgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xreadgroup(...args: RedisStreamValue[]): Promise<unknown>;
  xack(...args: RedisStreamValue[]): Promise<number>;
  xdel(...args: RedisStreamValue[]): Promise<number>;
  xautoclaim(...args: RedisStreamValue[]): Promise<unknown>;
};

type InboundPublisher = (payload: IInboundMessageSpoolPayload) => Promise<void>;

interface PublisherState {
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

interface StreamEntry {
  id: string;
  payload: IInboundMessageSpoolPayload | null;
  rawPayload: string | null;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_LOOP_IDLE_MS = 1000;
const DEFAULT_LOOP_ACTIVE_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_CLAIM_IDLE_MS = 30_000;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;

  return Math.floor(parsed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

@singleton()
export class InboundMessageSpoolService {
  private readonly groupName = 'inbound-message-publisher';
  private readonly batchSize = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  );
  private readonly maxAttempts = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_MAX_ATTEMPTS',
    DEFAULT_MAX_ATTEMPTS
  );
  private readonly claimIdleMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_CLAIM_IDLE_MS',
    DEFAULT_CLAIM_IDLE_MS
  );
  private readonly baseDelayMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_BASE_DELAY_MS',
    DEFAULT_BASE_DELAY_MS
  );
  private readonly maxDelayMs = readPositiveIntEnv(
    'INBOUND_MESSAGE_SPOOL_MAX_DELAY_MS',
    DEFAULT_MAX_DELAY_MS
  );
  private readonly states = new Map<string, PublisherState>();
  private readonly groupsReady = new Set<string>();

  constructor(@inject('Redis') private readonly redis: Redis) {}

  streamKey(provider: InboundMessageSpoolProvider, workerId: string): string {
    return `inbound:message:${provider}:${workerId}:stream`;
  }

  retrySetKey(provider: InboundMessageSpoolProvider, workerId: string): string {
    return `inbound:message:${provider}:${workerId}:retry`;
  }

  parkingSetKey(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string
  ): string {
    return `inbound:message:${provider}:${workerId}:parking`;
  }

  payloadHashKey(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string
  ): string {
    return `inbound:message:${provider}:${workerId}:payloads`;
  }

  startPublisher(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    publisher: InboundPublisher
  ): void {
    const key = this.streamKey(provider, workerId);
    if (this.states.has(key)) {
      return;
    }

    const state: PublisherState = { running: false };
    this.states.set(key, state);

    const loop = async () => {
      const current = this.states.get(key);
      if (!current || current.running) {
        this.scheduleLoop(key, loop, DEFAULT_LOOP_IDLE_MS);
        return;
      }

      current.running = true;
      let processed = 0;
      try {
        processed += await this.processRetryBatch(
          provider,
          workerId,
          publisher
        );
        processed += await this.processStreamBatch(
          provider,
          workerId,
          publisher
        );
      } catch (error) {
        console.error('[InboundMessageSpool] publisher loop failed:', {
          provider,
          worker_id: workerId,
          error: errorMessage(error),
        });
      } finally {
        current.running = false;
        this.scheduleLoop(
          key,
          loop,
          processed > 0 ? DEFAULT_LOOP_ACTIVE_MS : DEFAULT_LOOP_IDLE_MS
        );
      }
    };

    this.scheduleLoop(key, loop, DEFAULT_LOOP_ACTIVE_MS);
  }

  async publish(
    payload: IInboundMessageSpoolPayload,
    publisher: InboundPublisher
  ): Promise<boolean> {
    const stream = this.streamKey(payload.provider, payload.worker_id);
    const serialized = JSON.stringify(payload);
    let streamId: string | null = null;

    try {
      streamId = await this.streamRedis().xadd(
        stream,
        '*',
        'payload',
        serialized
      );
    } catch (error) {
      console.error('[InboundMessageSpool] failed to persist before publish:', {
        provider: payload.provider,
        worker_id: payload.worker_id,
        dedupe_key: payload.dedupe_key,
        error: errorMessage(error),
      });

      await publisher(payload);
      return true;
    }

    try {
      await publisher(payload);
      if (streamId) {
        await this.streamRedis().xdel(stream, streamId);
      }
      return true;
    } catch (error) {
      console.warn('[InboundMessageSpool] publish deferred to redis redrive:', {
        provider: payload.provider,
        worker_id: payload.worker_id,
        dedupe_key: payload.dedupe_key,
        stream_id: streamId,
        error: errorMessage(error),
      });
      return false;
    }
  }

  async parkConsumerMessage(
    payload: IInboundMessageParkingPayload
  ): Promise<void> {
    const workerId = payload.worker_id || 'message-upsert';
    await this.storeParking(
      payload.provider,
      workerId,
      this.parkingMember(payload),
      payload
    );
  }

  private scheduleLoop(
    key: string,
    loop: () => Promise<void>,
    delayMs: number
  ): void {
    const state = this.states.get(key);
    if (!state) return;

    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      state.timer = undefined;
      void loop();
    }, delayMs);
    state.timer.unref?.();
  }

  private async processStreamBatch(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    publisher: InboundPublisher
  ): Promise<number> {
    const stream = this.streamKey(provider, workerId);
    await this.ensureGroup(stream);

    const entries = [
      ...(await this.readClaimedEntries(stream, workerId)),
      ...(await this.readNewEntries(stream, workerId)),
    ];

    let processed = 0;
    for (const entry of entries) {
      processed += 1;
      await this.processStreamEntry(provider, workerId, entry, publisher);
    }

    return processed;
  }

  private async processRetryBatch(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    publisher: InboundPublisher
  ): Promise<number> {
    const retryKey = this.retrySetKey(provider, workerId);
    const hashKey = this.payloadHashKey(provider, workerId);
    const now = Date.now();
    const members = await this.redis.zrangebyscore(
      retryKey,
      '-inf',
      now,
      'LIMIT',
      0,
      this.batchSize
    );

    let processed = 0;
    for (const member of members) {
      const rawPayload = await this.redis.hget(hashKey, member);
      const payload = safeJsonParse<IInboundMessageSpoolPayload>(rawPayload);
      if (!payload) {
        await this.redis.zrem(retryKey, member);
        continue;
      }

      processed += 1;
      try {
        await publisher(payload);
        await Promise.all([
          this.redis.zrem(retryKey, member),
          this.redis.hdel(hashKey, member),
        ]);
      } catch (error) {
        await this.deferOrPark(provider, workerId, payload, error);
      }
    }

    return processed;
  }

  private async processStreamEntry(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    entry: StreamEntry,
    publisher: InboundPublisher
  ): Promise<void> {
    const stream = this.streamKey(provider, workerId);

    if (!entry.payload) {
      await this.storeParking(provider, workerId, entry.id, {
        provider,
        worker_id: workerId,
        event_source: 'invalid_stream_payload',
        reason: 'invalid_stream_payload',
        stage: 'inbound_message_spool.stream',
        parked_at: new Date().toISOString(),
        raw_payload: entry.rawPayload,
      });
      await this.ackDelete(stream, entry.id);
      return;
    }

    try {
      await publisher(entry.payload);
      await this.ackDelete(stream, entry.id);
    } catch (error) {
      await this.deferOrPark(provider, workerId, entry.payload, error);
      await this.ackDelete(stream, entry.id);
    }
  }

  private async deferOrPark(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    payload: IInboundMessageSpoolPayload,
    error: unknown
  ): Promise<void> {
    const attempts = payload.attempts + 1;
    const lastError = errorMessage(error);

    if (attempts >= this.maxAttempts) {
      await this.storeParking(provider, workerId, this.payloadMember(payload), {
        provider,
        account_id: payload.account_id,
        worker_id: workerId,
        event_source: payload.event_source,
        reason: 'retry_exhausted',
        stage: 'inbound_message_spool.publish',
        parked_at: new Date().toISOString(),
        kafka_topic: payload.kafka_topic,
        kafka_key: payload.kafka_key,
        retry_count: attempts,
        error: lastError,
        upsert: payload.upsert,
        raw_meta: payload.raw_meta,
      });
      await this.redis.zrem(
        this.retrySetKey(provider, workerId),
        this.payloadMember(payload)
      );
      return;
    }

    const retryPayload: IInboundMessageSpoolPayload = {
      ...payload,
      attempts,
      last_error: lastError,
      next_attempt_at: Date.now() + this.computeDelayMs(attempts),
    };
    await this.storeRetry(provider, workerId, retryPayload);
  }

  private async storeRetry(
    provider: InboundMessageSpoolProvider,
    workerId: string,
    payload: IInboundMessageSpoolPayload
  ): Promise<void> {
    const member = this.payloadMember(payload);
    const dueAt = payload.next_attempt_at ?? Date.now();
    await Promise.all([
      this.redis.hset(
        this.payloadHashKey(provider, workerId),
        member,
        JSON.stringify(payload)
      ),
      this.redis.zadd(this.retrySetKey(provider, workerId), dueAt, member),
    ]);
  }

  private async storeParking(
    provider: InboundMessageSpoolProvider | 'message_upsert_consumer',
    workerId: string,
    member: string,
    payload: IInboundMessageParkingPayload
  ): Promise<void> {
    await Promise.all([
      this.redis.hset(
        this.payloadHashKey(provider, workerId),
        member,
        JSON.stringify(payload)
      ),
      this.redis.zadd(
        this.parkingSetKey(provider, workerId),
        Date.now(),
        member
      ),
    ]);
  }

  private async ensureGroup(stream: string): Promise<void> {
    if (this.groupsReady.has(stream)) {
      return;
    }

    try {
      await this.streamRedis().xgroup(
        'CREATE',
        stream,
        this.groupName,
        '0',
        'MKSTREAM'
      );
    } catch (error) {
      if (!errorMessage(error).includes('BUSYGROUP')) {
        throw error;
      }
    }

    this.groupsReady.add(stream);
  }

  private async readNewEntries(
    stream: string,
    workerId: string
  ): Promise<StreamEntry[]> {
    const response = await this.streamRedis().xreadgroup(
      'GROUP',
      this.groupName,
      this.consumerName(workerId),
      'COUNT',
      this.batchSize,
      'STREAMS',
      stream,
      '>'
    );
    return this.parseReadGroupResponse(response);
  }

  private async readClaimedEntries(
    stream: string,
    workerId: string
  ): Promise<StreamEntry[]> {
    const response = await this.streamRedis().xautoclaim(
      stream,
      this.groupName,
      this.consumerName(workerId),
      this.claimIdleMs,
      '0-0',
      'COUNT',
      this.batchSize
    );
    return this.parseAutoClaimResponse(response);
  }

  private parseReadGroupResponse(response: unknown): StreamEntry[] {
    if (!Array.isArray(response)) return [];

    const entries: StreamEntry[] = [];
    for (const streamEntry of response) {
      if (!Array.isArray(streamEntry) || !Array.isArray(streamEntry[1])) {
        continue;
      }
      entries.push(...this.parseMessages(streamEntry[1]));
    }
    return entries;
  }

  private parseAutoClaimResponse(response: unknown): StreamEntry[] {
    if (!Array.isArray(response) || !Array.isArray(response[1])) {
      return [];
    }

    return this.parseMessages(response[1]);
  }

  private parseMessages(messages: unknown[]): StreamEntry[] {
    const entries: StreamEntry[] = [];
    for (const message of messages) {
      if (!Array.isArray(message) || typeof message[0] !== 'string') {
        continue;
      }

      const values = Array.isArray(message[1]) ? message[1] : [];
      const rawPayload = this.getField(values, 'payload');
      entries.push({
        id: message[0],
        payload: safeJsonParse<IInboundMessageSpoolPayload>(rawPayload),
        rawPayload,
      });
    }
    return entries;
  }

  private getField(values: unknown[], key: string): string | null {
    for (let index = 0; index < values.length - 1; index += 2) {
      if (values[index] === key && typeof values[index + 1] === 'string') {
        return values[index + 1] as string;
      }
    }
    return null;
  }

  private async ackDelete(stream: string, streamId: string): Promise<void> {
    await Promise.all([
      this.streamRedis().xack(stream, this.groupName, streamId),
      this.streamRedis().xdel(stream, streamId),
    ]);
  }

  private payloadMember(payload: IInboundMessageSpoolPayload): string {
    return `${payload.provider}:${payload.worker_id}:${payload.dedupe_key}`;
  }

  private parkingMember(payload: IInboundMessageParkingPayload): string {
    if (payload.kafka_topic && payload.partition !== undefined) {
      return `${payload.kafka_topic}:${payload.partition}:${payload.offset ?? 'unknown'}`;
    }

    if (payload.kafka_key) {
      return `${payload.provider}:${payload.kafka_key}`;
    }

    return `${payload.provider}:${payload.event_source}:${Date.now()}`;
  }

  private computeDelayMs(attempt: number): number {
    return Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
  }

  private consumerName(workerId: string): string {
    return `${workerId}:${process.pid}`;
  }

  private streamRedis(): RedisStreamClient {
    return this.redis as RedisStreamClient;
  }
}
