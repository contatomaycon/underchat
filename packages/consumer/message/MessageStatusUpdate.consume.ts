import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import { MessageStatusPendingService } from '@core/services/messageStatusPending.service';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class MessageStatusUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IMessageStatusUpdate> | null = null;
  private isRunning = false;
  private readonly idempotencyTtlSeconds = 86400;
  private readonly idempotencyPrefix = 'status-update:';
  private readonly missingStatusRetryIntervalMs = 1_000;
  private missingStatusRetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(MessageStatusService)
    private readonly messageStatusService: MessageStatusService,
    @inject(MessageStatusPendingService)
    private readonly messageStatusPendingService: MessageStatusPendingService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private parseMessage(value: Buffer | null): IMessageStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageStatusUpdate;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateMessageStatus();
    this.startMissingStatusRetryWorker();
    this.runner = new KafkaConsumerRunner<IMessageStatusUpdate>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-message-status-update',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        this.getMessageKey(data.account_id, data.message_id),
      handle: (data) => this.processStatusUpdate(data),
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    if (this.missingStatusRetryTimer) {
      clearInterval(this.missingStatusRetryTimer);
      this.missingStatusRetryTimer = null;
    }

    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private startMissingStatusRetryWorker(): void {
    if (this.missingStatusRetryTimer) {
      clearInterval(this.missingStatusRetryTimer);
    }

    this.missingStatusRetryTimer = setInterval(() => {
      void this.processDuePendingStatuses().catch(() => {});
    }, this.missingStatusRetryIntervalMs);

    this.missingStatusRetryTimer.unref?.();
  }

  private async processDuePendingStatuses(): Promise<void> {
    const pendingStatuses =
      await this.messageStatusPendingService.claimDuePendingStatuses();

    await Promise.all(
      pendingStatuses.map((data) => this.processPendingStatus(data))
    );
  }

  private async processPendingStatus(
    data: IMessageStatusUpdate
  ): Promise<void> {
    const normalizedPatch = this.messageStatusPendingService.mergePatches([
      data.patch,
    ]);
    const statusUpdate: IMessageStatusUpdate = {
      ...data,
      patch: normalizedPatch,
    };
    const startTime = Date.now();

    try {
      const alreadyApplied =
        await this.messageStatusPendingService.isApplied(statusUpdate);

      if (alreadyApplied) {
        await this.messageStatusPendingService.clearPendingStatus(
          statusUpdate.account_id,
          statusUpdate.message_id
        );
        await this.markAsProcessed(statusUpdate);
        return;
      }

      const updatedMessage =
        await this.messageStatusService.updateSummaryByWhatsAppId(
          statusUpdate.account_id,
          statusUpdate.message_id,
          normalizedPatch,
          statusUpdate.key
        );

      const duration = Date.now() - startTime;
      if (!updatedMessage?.message_id) {
        await this.messageStatusPendingService.reschedulePendingStatus(
          statusUpdate,
          {
            batchSize: 1,
            duration,
          }
        );
        return;
      }

      await this.messageStatusPendingService.markApplied(
        statusUpdate,
        updatedMessage.message_id
      );
      await this.markAsProcessed(statusUpdate);
    } catch {
      const duration = Date.now() - startTime;

      await this.messageStatusPendingService.reschedulePendingStatus(
        statusUpdate,
        {
          batchSize: 1,
          duration,
        },
        {
          incrementRetry: false,
        }
      );
    }
  }

  private getIdempotencyKey(data: IMessageStatusUpdate): string {
    const patchHash = MessageStatusService.hashPatch(data.patch);
    return `${this.idempotencyPrefix}${data.account_id}:${data.message_id}:${patchHash}`;
  }

  private async isAlreadyProcessed(
    data: IMessageStatusUpdate
  ): Promise<boolean> {
    const key = this.getIdempotencyKey(data);
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  private async markAsProcessed(data: IMessageStatusUpdate): Promise<void> {
    const key = this.getIdempotencyKey(data);
    try {
      await this.redis.setex(key, this.idempotencyTtlSeconds, '1');
    } catch {}
  }

  private getMessageKey(accountId: string, messageId: string): string {
    return `${accountId}:${messageId}`;
  }

  private async processStatusUpdate(data: IMessageStatusUpdate): Promise<void> {
    const mergedPatch = this.messageStatusPendingService.mergePatches([
      data.patch,
    ]);
    const statusUpdate: IMessageStatusUpdate = {
      ...data,
      patch: mergedPatch,
    };
    const startTime = Date.now();

    try {
      const alreadyApplied =
        await this.messageStatusPendingService.isApplied(statusUpdate);

      if (alreadyApplied) {
        await this.messageStatusPendingService.clearPendingStatus(
          statusUpdate.account_id,
          statusUpdate.message_id
        );
        await this.markAsProcessed(statusUpdate);
        return;
      }

      const isAlreadyProcessed = await this.isAlreadyProcessed(statusUpdate);

      if (isAlreadyProcessed) {
        await this.messageStatusPendingService.clearPendingStatus(
          statusUpdate.account_id,
          statusUpdate.message_id
        );
        return;
      }

      const updatedMessage =
        await this.messageStatusService.updateSummaryByWhatsAppId(
          statusUpdate.account_id,
          statusUpdate.message_id,
          mergedPatch,
          statusUpdate.key
        );

      if (!updatedMessage) {
        const duration = Date.now() - startTime;

        await this.messageStatusPendingService.deferMissingStatusUpdate(
          statusUpdate,
          mergedPatch,
          {
            batchSize: 1,
            duration,
          }
        );
        return;
      }

      await this.messageStatusPendingService.markApplied(
        statusUpdate,
        updatedMessage.message_id
      );

      await this.markAsProcessed(statusUpdate);
    } catch {
      const duration = Date.now() - startTime;

      await this.messageStatusPendingService.reschedulePendingStatus(
        statusUpdate,
        {
          batchSize: 1,
          duration,
        },
        {
          incrementRetry: false,
        }
      );
    }
  }
}
