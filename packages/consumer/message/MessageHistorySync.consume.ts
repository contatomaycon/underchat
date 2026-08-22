import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
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
import {
  MessageHistoryReceiptCacheService,
  MessageHistoryReceiptReservationBusyError,
} from '@core/services/messageHistoryReceiptCache.service';
import { WAMessage } from '@whiskeysockets/baileys';
import { buildUpsertMessageKafkaKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type { KafkaConsumerRunnerContext } from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import {
  IWhatsappRuntimeFence,
  WhatsappRuntimeFenceService,
} from '@core/services/whatsappRuntimeFence.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';
import { resolveHistoryReconciliationConfig } from '@core/common/functions/historyReconciliationConfig';

@singleton()
export class MessageHistorySyncConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUpsertMessage> | null = null;
  private isRunning = false;

  private readonly historyReconciliationConfig =
    resolveHistoryReconciliationConfig();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS_MS = [500, 2000, 5000];
  private readonly WORKER_DATES_CACHE_TTL_MS = 60 * 1000;
  private workerDatesCache: Map<string, ICachedWorkerDates> = new Map();
  private readonly receiptCache: MessageHistoryReceiptCacheService;
  private readonly runtimeFence: WhatsappRuntimeFenceService;

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
    this.runtimeFence = new WhatsappRuntimeFenceService(this.redis);
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
    this.runner = new KafkaConsumerRunner<IUpsertMessage>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.messageHistorySync,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data, message) =>
        buildUpsertMessageKafkaKey(data, message.key?.toString() ?? null),
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.runtimeFence.acquireEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: (data, context) =>
        this.processHistoryMessageWithLifecycle(
          topic,
          data,
          context.partition,
          context.offset,
          context
        ),
      maxRetries: this.MAX_RETRIES,
      retryDelaysMs: this.RETRY_DELAYS_MS,
      shouldContinueRetryWithoutCommit: (_data, _context, error) =>
        error instanceof MessageHistoryReceiptReservationBusyError,
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  private async processHistoryMessageWithLifecycle(
    topic: string,
    data: IUpsertMessage,
    partition: number,
    offset: number,
    context: KafkaConsumerRunnerContext<IUpsertMessage>
  ): Promise<void> {
    this.logLifecycle(data, {
      stage: 'message_history_sync.consume.received',
      decision: 'consume_kafka_payload',
      outcome: 'received',
      topic,
      partition,
      offset,
    });

    try {
      context.assertActive();
      const activeFence = await this.resolveActiveRuntimeFence(data);
      if (
        WhatsappRuntimeFenceService.requiresFence(data.source_provider) &&
        !activeFence
      ) {
        this.logLifecycle(data, {
          stage: 'message_history_sync.skip',
          decision: 'runtime_fence',
          outcome: 'skipped',
          reason: 'stale_or_missing_runtime_fence',
          topic,
          partition,
          offset,
        });
        return;
      }
      context.assertActive();
      await this.handleHistoryMessage(data, context.assertActive, activeFence);
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
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private async handleHistoryMessage(
    data: IUpsertMessage,
    assertActive: () => void = () => undefined,
    activeFence: IWhatsappRuntimeFence | null = null
  ): Promise<void> {
    if (!this.historyReconciliationConfig.enabled) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'history_reconciliation_enabled',
        outcome: 'skipped',
        reason: 'disabled',
      });
      return;
    }

    const resolvedFence =
      activeFence ?? (await this.resolveActiveRuntimeFence(data));
    if (
      WhatsappRuntimeFenceService.requiresFence(data.source_provider) &&
      !resolvedFence
    ) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'runtime_fence',
        outcome: 'skipped',
        reason: 'stale_or_missing_runtime_fence',
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
    if (minTimestampMs === null) {
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'worker_active',
        outcome: 'skipped',
        reason: 'worker_missing_or_deleted',
      });
      return;
    }
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

    const reservation = await this.receiptCache.reserveForHistory(data);
    if (reservation.status === 'duplicate') {
      if (reservation.state === 'reserved') {
        throw new MessageHistoryReceiptReservationBusyError();
      }
      this.logLifecycle(data, {
        stage: 'message_history_sync.skip',
        decision: 'receipt_cache_reservation',
        outcome: 'skipped',
        reason: 'already_known',
        receipt_state: reservation.state,
        event_id: reservation.eventId,
      });
      return;
    }

    const claim = reservation.claim;
    await this.receiptCache.withReservation(claim, async (assertClaimOwned) => {
      const assertProcessingActive = async (): Promise<void> => {
        assertActive();
        await assertClaimOwned();
        assertActive();
      };

      await assertProcessingActive();
      const exists = await this.messageExistsInElastic(data);
      await assertProcessingActive();
      if (exists) {
        this.logLifecycle(data, {
          stage: 'message_history_sync.skip',
          decision: 'elastic_existing_message',
          outcome: 'skipped',
          reason: 'message_already_exists',
        });
        const knownTransition =
          await this.receiptCache.markKnownFromReservation(claim);
        if (
          knownTransition !== 'transitioned' &&
          knownTransition !== 'already_completed'
        ) {
          throw new Error(`message_history_receipt_known_${knownTransition}`);
        }
        return;
      }

      const payload: IUpsertMessage = {
        ...data,
        from_history_sync: true,
      };
      const kafkaKey = buildUpsertMessageKafkaKey(payload, data.message.key.id);

      await assertProcessingActive();
      if (!(await this.runtimeFence.isCurrent(data))) {
        this.logLifecycle(data, {
          stage: 'message_history_sync.skip',
          decision: 'runtime_fence',
          outcome: 'skipped',
          reason: 'runtime_fence_revoked_before_publish',
        });
        return;
      }
      await assertProcessingActive();
      const publishingTransition =
        await this.receiptCache.markPublishing(claim);
      if (publishingTransition === 'already_completed') {
        this.logLifecycle(data, {
          stage: 'message_history_sync.skip',
          decision: 'receipt_cache_publishing',
          outcome: 'skipped',
          reason: 'receipt_already_completed',
          event_id: claim.eventId,
        });
        return;
      }
      if (publishingTransition !== 'transitioned') {
        throw new Error(
          `message_history_receipt_publishing_${publishingTransition}`
        );
      }
      assertActive();
      try {
        await this.streamProducerService.send(
          this.kafkaServiceQueueService.upsertMessage(),
          payload,
          kafkaKey,
          undefined,
          assertActive
        );
      } catch (error) {
        const transition = await this.receiptCache.markAmbiguous(claim, error);
        if (
          transition !== 'transitioned' &&
          transition !== 'already_completed'
        ) {
          throw new Error(`message_history_receipt_ambiguous_${transition}`, {
            cause: error,
          });
        }
        throw error;
      }

      const transition = await this.receiptCache.markPublished(claim);
      if (transition !== 'transitioned' && transition !== 'already_completed') {
        throw new Error(`message_history_receipt_published_${transition}`);
      }
      this.logLifecycle(payload, {
        stage: 'message_history_sync.kafka.publish',
        decision: 'publish_history_upsert',
        outcome: 'published',
        topic: this.kafkaServiceQueueService.upsertMessage(),
        kafka_key: kafkaKey,
        event_id: claim.eventId,
      });
    });
  }

  private async resolveActiveRuntimeFence(
    data: IUpsertMessage
  ): Promise<IWhatsappRuntimeFence | null> {
    if (!WhatsappRuntimeFenceService.requiresFence(data.source_provider)) {
      return null;
    }
    if (!(await this.runtimeFence.isCurrent(data))) {
      return null;
    }

    return this.runtimeFence.view(data.worker_id);
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
  ): Promise<number | null> {
    const now = Date.now();
    const historyCutoff = now - this.historyReconciliationConfig.windowMs;
    const dates = await this.getWorkerDatesMs(accountId, workerId);
    if (!dates.workerActive) {
      return null;
    }

    const createdAtMs = dates.createdAtMs ?? 0;

    // connection_date is advanced by a reconnect. Using it as a lower bound
    // removes exactly the outage interval that reconciliation must recover.
    return Math.max(historyCutoff, createdAtMs);
  }

  private async getWorkerDatesMs(
    accountId: string,
    workerId: string
  ): Promise<{
    workerActive: boolean;
    createdAtMs: number | null;
  }> {
    if (!accountId || !workerId) {
      return {
        workerActive: false,
        createdAtMs: null,
      };
    }

    const cacheKey = `${accountId}:${workerId}`;
    const cached = this.workerDatesCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return {
        workerActive: cached.workerActive,
        createdAtMs: cached.createdAtMs,
      };
    }

    const view =
      await this.workerService.viewWorkerForMonitorConsistent(workerId);
    const workerActive = Boolean(
      view && view.account_id === accountId && view.deleted_at === null
    );
    const createdAt = view?.created_at;

    const createdAtMs =
      createdAt && !Number.isNaN(Date.parse(createdAt))
        ? new Date(createdAt).getTime()
        : null;

    this.workerDatesCache.set(cacheKey, {
      workerActive,
      createdAtMs,
      expiresAt: now + this.WORKER_DATES_CACHE_TTL_MS,
    });

    return { workerActive, createdAtMs };
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
}
