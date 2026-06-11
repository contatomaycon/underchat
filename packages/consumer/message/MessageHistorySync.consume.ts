import { singleton, inject } from 'tsyringe';
import type {
  KafkaConsumer,
  LibrdKafkaError,
  MessageHeader,
} from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { ICachedWorkerDates } from '@core/common/interfaces/ICachedWorkerDates';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IMessageKeyIdContext } from '@core/common/interfaces/IMessageKeyIdContext';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { MessageHistoryReceiptCacheService } from '@core/services/messageHistoryReceiptCache.service';
import { WAMessage } from '@whiskeysockets/baileys';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import Redis from 'ioredis';

interface KafkaConsumerMessage {
  value: Buffer | null;
  partition: number;
  offset: number;
  headers?: MessageHeader[];
}

@singleton()
export class MessageHistorySyncConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  private readonly HISTORY_RECONCILIATION_ENABLED =
    process.env.HISTORY_RECONCILIATION_ENABLED !== 'false';
  private readonly HISTORY_WINDOW_MS = this.readPositiveIntEnv(
    'HISTORY_RECONCILIATION_MAX_AGE_MS',
    60 * 60 * 1000
  );
  private readonly WORKER_DATES_CACHE_TTL_MS = 60 * 1000;
  private workerDatesCache: Map<string, ICachedWorkerDates> = new Map();
  private readonly receiptCache: MessageHistoryReceiptCacheService;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService
  ) {
    this.receiptCache = new MessageHistoryReceiptCacheService(this.redis);
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IUpsertMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IUpsertMessage | null;

      if (!parsed) return null;

      parsed.has_quoted = !!parsed.has_quoted;

      return parsed;
    } catch {
      return null;
    }
  }

  private logLifecycle(
    data: IUpsertMessage | null | undefined,
    event: Record<string, unknown>
  ): void {
    void data;
    void event;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.upsertMessageHistory();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-history-sync'
    );

    this.consumer.on('data', (message) => {
      void this.handleKafkaMessage(
        topic,
        message as KafkaConsumerMessage
      ).catch((error) => {
        console.error('[HistorySync] Error handling Kafka message:', error);
      });
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  private async handleKafkaMessage(
    topic: string,
    message: KafkaConsumerMessage
  ): Promise<void> {
    const { partition, offset } = message;
    const data = this.parseMessage(message.value);

    if (!data) {
      await this.commitNext(topic, partition, offset);
      return;
    }

    const previousChain =
      this.partitionChains.get(partition) ?? Promise.resolve();

    const currentChain = previousChain.then(() =>
      this.processKafkaMessageInPartition(topic, data, partition, offset)
    );

    this.partitionChains.set(partition, currentChain);
  }

  private async processKafkaMessageInPartition(
    topic: string,
    data: IUpsertMessage,
    partition: number,
    offset: number
  ): Promise<void> {
    await this.processHistoryMessageWithLifecycle(
      topic,
      data,
      partition,
      offset
    );
  }

  private async processHistoryMessageWithLifecycle(
    topic: string,
    data: IUpsertMessage,
    partition: number,
    offset: number
  ): Promise<void> {
    this.logLifecycle(data, {
      stage: 'message_history_sync.consume.received',
      decision: 'consume_kafka_payload',
      outcome: 'received',
      topic,
      partition,
      offset,
    });

    const heartbeat = async () => {
      this.consumer?.commit();
    };

    const stop = startHeartbeat(heartbeat);
    try {
      await this.handleHistoryMessage(data);
    } catch (error) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.process.error',
        decision: 'process_history_message',
        outcome: 'error',
        reason: 'exception',
        level: 'error',
        topic,
        partition,
        offset,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[HistorySync] Error processing message:', {
        error,
        account_id: data.account_id,
        worker_id: data.worker_id,
        message_key_id: data.message?.key?.id,
      });
    } finally {
      stop();
      await this.commitNext(topic, partition, offset);
    }
  }

  public async close(): Promise<void> {
    await Promise.all(this.partitionChains.values());

    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
      this.partitionChains.clear();
    }
  }

  private async handleHistoryMessage(data: IUpsertMessage): Promise<void> {
    if (!this.HISTORY_RECONCILIATION_ENABLED) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'history_reconciliation_enabled',
        outcome: 'skipped',
        reason: 'disabled',
      });
      return;
    }

    if (data.is_call_event) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'history_event_filter',
        outcome: 'skipped',
        reason: 'call_event',
      });
      return;
    }

    if (!data?.message?.key?.id) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'message_key_validation',
        outcome: 'skipped',
        reason: 'missing_message_key_id',
        level: 'warn',
      });
      return;
    }

    if (this.isMessageFromMe(data.message)) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'history_direction_filter',
        outcome: 'skipped',
        reason: 'message_from_me',
      });
      return;
    }

    const messageTimestampMs = this.getMessageTimestampMs(data.message);
    if (!messageTimestampMs) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'timestamp_validation',
        outcome: 'skipped',
        reason: 'missing_message_timestamp',
        level: 'warn',
      });
      return;
    }

    const minTimestampMs = await this.getMinAllowedTimestampMs(
      data.account_id,
      data.worker_id
    );
    if (messageTimestampMs < minTimestampMs) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'history_window_filter',
        outcome: 'skipped',
        reason: 'older_than_min_allowed_timestamp',
        message_timestamp_ms: messageTimestampMs,
        min_timestamp_ms: minTimestampMs,
      });
      return;
    }

    if (await this.receiptCache.isKnown(data)) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'receipt_cache_known',
        outcome: 'skipped',
        reason: 'already_known',
      });
      return;
    }

    const acquired = await this.receiptCache.acquireInflight(data);
    if (!acquired) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'receipt_cache_inflight',
        outcome: 'skipped',
        reason: 'already_inflight',
      });
      return;
    }

    const exists = await this.messageExistsInElastic(data);
    if (exists) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'elastic_existing_message',
        outcome: 'skipped',
        reason: 'message_already_exists',
      });
      await this.receiptCache.markKnown(data);
      await this.receiptCache.releaseInflight(data);
      return;
    }

    const payload: IUpsertMessage = {
      ...data,
      from_history_sync: true,
    };
    const kafkaKey = buildUpsertMessageKafkaKey(payload, data.message.key.id);

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.upsertMessage(),
      payload,
      kafkaKey
    );
    this.logLifecycle(payload, {
      stage: 'message_history_sync.kafka.publish',
      decision: 'publish_history_upsert',
      outcome: 'published',
      topic: this.kafkaServiceQueueService.upsertMessage(),
      kafka_key: kafkaKey,
    });
  }

  private getMessageTimestampMs(
    message: WAMessage | null | undefined
  ): number | null {
    const messageLike = message as
      | (WAMessage & {
          timestamp?: unknown;
          _data?: Record<string, unknown>;
        })
      | null
      | undefined;
    const timestamps = [
      messageLike?.messageTimestamp,
      messageLike?.timestamp,
      messageLike?._data?.timestamp,
      messageLike?._data?.t,
      messageLike?._data?.senderTimestampMs,
      messageLike?._data?.senderTimestamp,
      messageLike?._data?.latestEditSenderTimestampMs,
      messageLike?._data?.clientReceivedTsMillis,
    ]
      .map((raw) => this.normalizeTimestampMs(raw))
      .filter((value): value is number => value !== null);

    return timestamps.length > 0 ? Math.min(...timestamps) : null;
  }

  private normalizeTimestampMs(raw: unknown): number | null {
    if (!raw) {
      return null;
    }
    if (typeof raw === 'number') {
      return raw > 1_000_000_000_000 ? raw : raw * 1000;
    }

    if (typeof raw === 'string') {
      const asNumber = Number(raw);
      if (!Number.isFinite(asNumber)) return null;
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    }

    if (typeof raw === 'bigint') {
      const asNumber = Number(raw);
      if (!Number.isFinite(asNumber)) return null;
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    }

    if (typeof raw === 'object' && raw && 'toNumber' in raw) {
      const asNumber = (raw as { toNumber: () => number }).toNumber();
      if (!Number.isFinite(asNumber)) return null;
      return asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    }

    const fallback = Number(raw as unknown);
    if (!Number.isFinite(fallback)) {
      return null;
    }

    return fallback > 1_000_000_000_000 ? fallback : fallback * 1000;
  }

  private isMessageFromMe(message: WAMessage | null | undefined): boolean {
    const key = message?.key as
      | (IMessageKeyIdContext & {
          fromMe?: unknown;
          from_me?: unknown;
        })
      | undefined;
    const keyFromMe = key?.fromMe ?? key?.from_me;
    if (this.isTrueLike(keyFromMe)) {
      return true;
    }

    const parsed = parseSerializedMessageId(message?.key?.id);
    return parsed?.fromMe === true;
  }

  private isTrueLike(value: unknown): boolean {
    if (value === true) {
      return true;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    return false;
  }

  private async getMinAllowedTimestampMs(
    accountId: string,
    workerId: string
  ): Promise<number> {
    const now = Date.now();
    const historyCutoff = now - this.HISTORY_WINDOW_MS;
    const dates = await this.getWorkerDatesMs(accountId, workerId);

    const connectionDateMs = dates.connectionDateMs ?? 0;
    const createdAtMs = dates.createdAtMs ?? 0;

    return Math.max(historyCutoff, connectionDateMs, createdAtMs);
  }

  private async getWorkerDatesMs(
    accountId: string,
    workerId: string
  ): Promise<{ connectionDateMs: number | null; createdAtMs: number | null }> {
    if (!accountId || !workerId) {
      return { connectionDateMs: null, createdAtMs: null };
    }

    const cacheKey = `${accountId}:${workerId}`;
    const cached = this.workerDatesCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return {
        connectionDateMs: cached.connectionDateMs,
        createdAtMs: cached.createdAtMs,
      };
    }

    const view = await this.workerService.viewWorker(accountId, workerId);
    const connectionDate = view?.connection_date;
    const createdAt = view?.created_at;

    const connectionDateMs =
      connectionDate && !Number.isNaN(Date.parse(connectionDate))
        ? new Date(connectionDate).getTime()
        : null;
    const createdAtMs =
      createdAt && !Number.isNaN(Date.parse(createdAt))
        ? new Date(createdAt).getTime()
        : null;

    this.workerDatesCache.set(cacheKey, {
      connectionDateMs,
      createdAtMs,
      expiresAt: now + this.WORKER_DATES_CACHE_TTL_MS,
    });

    return { connectionDateMs, createdAtMs };
  }

  private async messageExistsInElastic(data: IUpsertMessage): Promise<boolean> {
    const accountId = data.account_id;
    const workerId = data.worker_id;
    const messageId = data.message?.key?.id;
    if (!accountId || !workerId || !messageId) {
      return false;
    }

    const keyIdCandidates = this.buildMessageKeyIdCandidates(
      messageId,
      data.message?.key
    );
    if (!keyIdCandidates.length) {
      return false;
    }

    const remoteCandidates = this.collectRemoteIdCandidatesFromKey(
      data.message?.key
    );
    const messageKeyMust: Array<Record<string, unknown>> = [
      {
        bool: {
          should: keyIdCandidates.map((candidate) => ({
            term: { 'message_key.id': candidate },
          })),
          minimum_should_match: 1,
        },
      },
    ];

    if (remoteCandidates.length) {
      messageKeyMust.push({
        bool: {
          should: remoteCandidates.flatMap((candidate) => [
            { term: { 'message_key.remote_jid': candidate } },
            { term: { 'message_key.remote_jid_alt': candidate } },
            { term: { 'message_key.participant': candidate } },
            { term: { 'message_key.participant_alt': candidate } },
          ]),
          minimum_should_match: 1,
        },
      });
    }

    const queryElastic = {
      size: 1,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: { 'account.id': accountId },
                },
              },
            },
            {
              term: {
                'worker.id': workerId,
              },
            },
            {
              nested: {
                path: 'message_key',
                query: {
                  bool: {
                    must: messageKeyMust,
                  },
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    return !!result && result.hits.hits.length > 0;
  }

  private collectRemoteIdCandidatesFromKey(
    keyContext?: IMessageKeyIdContext
  ): string[] {
    if (!keyContext) return [];

    const rawCandidates = [
      keyContext.remoteJid,
      keyContext.remoteJidAlt,
      keyContext.participant,
      keyContext.participantAlt,
      keyContext.remote_jid,
      keyContext.remote_jid_alt,
      keyContext.participant_alt,
    ];

    const candidates = new Set<string>();

    for (const candidate of rawCandidates) {
      if (typeof candidate !== 'string' || candidate.trim() === '') continue;

      const raw = candidate.trim();
      candidates.add(raw);

      const normalized = normalizeJid(raw) ?? raw;
      candidates.add(normalized);

      if (normalized.endsWith('@s.whatsapp.net')) {
        candidates.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
      }

      if (normalized.endsWith('@c.us')) {
        candidates.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
      }
    }

    return Array.from(candidates);
  }

  private collectFromMeCandidatesFromKey(
    keyContext?: IMessageKeyIdContext
  ): boolean[] {
    if (!keyContext) {
      return [false, true];
    }

    const fromMe = keyContext.fromMe ?? keyContext.from_me;
    if (typeof fromMe === 'boolean') {
      return [fromMe];
    }

    return [false, true];
  }

  private buildMessageKeyIdCandidates(
    messageId: string,
    keyContext?: IMessageKeyIdContext
  ): string[] {
    const normalizedId = messageId.trim();
    if (!normalizedId) {
      return [];
    }

    const candidates = new Set<string>([normalizedId]);
    const parsed = parseSerializedMessageId(normalizedId);
    const stanzaId = parsed?.stanzaId ?? normalizedId;

    candidates.add(stanzaId);

    const remoteCandidates = new Set<string>([
      ...this.collectRemoteIdCandidatesFromKey(keyContext),
      ...(parsed?.remoteJid ? [parsed.remoteJid] : []),
    ]);

    const fromMeCandidates = this.collectFromMeCandidatesFromKey(keyContext);
    if (parsed && !fromMeCandidates.includes(parsed.fromMe)) {
      fromMeCandidates.push(parsed.fromMe);
    }

    for (const remoteCandidate of remoteCandidates) {
      for (const fromMe of fromMeCandidates) {
        candidates.add(`${fromMe}_${remoteCandidate}_${stanzaId}`);
      }
    }

    return Array.from(candidates);
  }

  private readPositiveIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return Math.floor(parsed);
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    try {
      await commitOffset(this.consumerOrThrow, topic, partition, offset);
    } catch (error: unknown) {
      if (
        MessageHistorySyncConsume.isLibrdKafkaError(error) &&
        error.code === 22
      ) {
        return;
      }

      throw error;
    }
  }

  private static isLibrdKafkaError(error: unknown): error is LibrdKafkaError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'number'
    );
  }
}
