import { singleton, inject } from 'tsyringe';
import { KafkaConsumer, type LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { ICachedWorkerDates } from '@core/common/interfaces/ICachedWorkerDates';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { WAMessage } from '@whiskeysockets/baileys';

@singleton()
export class MessageHistorySyncConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  private readonly HISTORY_WINDOW_MS = 6 * 60 * 60 * 1000;
  private readonly WORKER_DATES_CACHE_TTL_MS = 60 * 1000;
  private workerDatesCache: Map<string, ICachedWorkerDates> = new Map();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly workerService: WorkerService,
    private readonly streamProducerService: StreamProducerService
  ) {}

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

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      console.log('[MessageHistorySync] Received message:');
      console.dir(data, { depth: null, colors: true });

      const partition = message.partition;
      const offset = message.offset;

      const previousChain =
        this.partitionChains.get(partition) ?? Promise.resolve();

      const currentChain = previousChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);
        try {
          await this.handleHistoryMessage(data);
        } catch (error) {
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
      });

      this.partitionChains.set(partition, currentChain);
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
    if (data.is_call_event) {
      return;
    }

    if (!data?.message?.key?.id) {
      return;
    }

    if (data.message?.key?.fromMe) {
      return;
    }

    const messageTimestampMs = this.getMessageTimestampMs(data.message);
    if (!messageTimestampMs) {
      return;
    }

    const minTimestampMs = await this.getMinAllowedTimestampMs(
      data.account_id,
      data.worker_id
    );
    if (messageTimestampMs < minTimestampMs) {
      return;
    }

    const exists = await this.messageExistsInElastic(
      data.account_id,
      data.message.key.id
    );
    if (exists) {
      return;
    }

    const payload: IUpsertMessage = {
      ...data,
      from_history_sync: true,
    };

    await this.streamProducerService.send(
      this.kafkaServiceQueueService.upsertMessage(),
      payload,
      data.message.key.id
    );
  }

  private getMessageTimestampMs(
    message: WAMessage | null | undefined
  ): number | null {
    const raw = message?.messageTimestamp;
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

  private async messageExistsInElastic(
    accountId: string,
    messageId: string
  ): Promise<boolean> {
    if (!accountId || !messageId) {
      return false;
    }

    const must: Array<Record<string, unknown>> = [
      {
        nested: {
          path: 'message_key',
          query: {
            term: { 'message_key.id': messageId },
          },
        },
      },
    ];

    if (accountId) {
      must.push({
        nested: {
          path: 'account',
          query: {
            term: { 'account.id': accountId },
          },
        },
      });
    }

    const queryElastic = {
      size: 1,
      query: {
        bool: {
          must,
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.message,
      queryElastic
    );

    return !!result && result.hits.hits.length > 0;
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
