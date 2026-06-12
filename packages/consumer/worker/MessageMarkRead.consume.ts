import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { baileysEnvironment } from '@core/config/environments';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IMessageStatusUpdate } from '@core/common/interfaces/IMessageStatusUpdate';
import { MessageStatusService } from '@core/services/messageStatus.service';
import type { WAMessageKey } from '@whiskeysockets/baileys';
import Redis from 'ioredis';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import type { IUpsertMessageKey } from '@core/common/interfaces/IUpsertMessage';

type MarkReadKey = IUpsertMessageKey & {
  remote_jid?: string | null;
};

@singleton()
export class MessageMarkReadConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IMessageMarkRead> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private parseMessage(value: Buffer | null): IMessageMarkRead | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IMessageMarkRead;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.markMessageRead();
    this.runner = new KafkaConsumerRunner<IMessageMarkRead>({
      kafka: this.kafka,
      topic,
      groupId: `group-underchat-mark-read-${baileysEnvironment.baileysWorkerId}`,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => this.resolveEntityKey(data),
      handle: (data) => this.processMarkRead(data),
      onInvalidMessage: () => {
        console.warn('Skipping invalid message mark read payload');
      },
      onFailed: (payload, _context, error) => {
        console.error('Error marking messages as read:', {
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          error,
        });
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000],
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }

  private async isMarkAsReadEnabled(workerId: string): Promise<boolean> {
    try {
      const cacheKey = `worker:${workerId}:mark_as_read`;
      const cached = await this.redis.get(cacheKey);
      return cached === 'true';
    } catch {
      return false;
    }
  }

  private async processMarkRead(data: IMessageMarkRead): Promise<void> {
    if (data.worker_id !== baileysEnvironment.baileysWorkerId) {
      return;
    }

    const isEnabled = await this.isMarkAsReadEnabled(data.worker_id);
    if (!isEnabled) {
      return;
    }

    await this.baileysIncomingMessageService.markRead(
      data.keys as WAMessageKey[]
    );

    await Promise.all(
      data.keys.map(async (key) => {
        if (!key.id) return;

        const statusUpdate: IMessageStatusUpdate = {
          account_id: data.account_id,
          message_id: key.id,
          patch: { is_seen: true },
          key: key as WAMessageKey,
        };

        const kafkaKey = MessageStatusService.statusKafkaKey(
          data.account_id,
          key.id
        );

        await this.streamProducerService.send(
          this.kafkaServiceQueueService.updateMessageStatus(),
          statusUpdate,
          kafkaKey
        );
      })
    );
  }

  private resolveEntityKey(data: IMessageMarkRead): string {
    const jids = this.resolveJids(data.keys);
    return `${data.account_id}:${data.worker_id}:${jids.join(',') || 'unknown-chat'}`;
  }

  private resolveJids(keys: IUpsertMessageKey[]): string[] {
    return Array.from(
      new Set(
        keys
          .map((key) => {
            const typedKey = key as MarkReadKey;
            return (
              typedKey.remoteJid ??
              typedKey.remoteJidAlt ??
              typedKey.remote_jid ??
              null
            );
          })
          .filter((jid): jid is string => Boolean(jid))
      )
    ).sort();
  }
}
