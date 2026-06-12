import { singleton, inject, container } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { remoteJid } from '@core/common/functions/remoteJid';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { TFunction } from 'i18next';
import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { buildUpsertMessageDlqKey } from '@core/common/functions/buildUpsertMessageKafkaKey';
import Redis from 'ioredis';

@singleton()
export class MessageUpsertDlqConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUpsertMessage> | null = null;
  private isRunning = false;
  private messageUpsertConsume: MessageUpsertConsume;
  private readonly processedDedupePrefix = 'message-upsert:dlq:processed:v1';
  private readonly processedDedupeTtlSeconds = 7 * 24 * 60 * 60;
  private readonly localProcessedDedupe = new Set<string>();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject('Redis') private readonly redis?: Redis
  ) {
    this.messageUpsertConsume = container.resolve(MessageUpsertConsume);
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

  public async execute(t: TFunction<'translation', undefined>): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.upsertMessageDlq();

    this.runner = new KafkaConsumerRunner<IUpsertMessage>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-message-upsert-dlq',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data, message) =>
        this.resolveDlqDedupeKey(data, message.key?.toString() ?? null),
      handle: (data) => this.processDlqOnce(t, data),
      maxRetries: 1,
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

  private async processDlqOnce(
    t: TFunction<'translation', undefined>,
    data: IUpsertMessage
  ): Promise<void> {
    const dedupeKey = this.resolveDlqDedupeKey(data);
    const acquired = await this.acquireDedupe(dedupeKey);
    if (!acquired) {
      return;
    }

    try {
      const jid = remoteJid(data.message?.key);
      const jidAlt = remoteJidAlt(data.message?.key);

      if (!jid && !jidAlt) {
        throw new Error('Received message without remoteJid');
      }

      const phone = getPhoneFromJid(jid, jidAlt);
      if (!phone) {
        throw new Error('Received message without valid phone');
      }

      await (this.messageUpsertConsume as any).createOrUpdateChat(
        t,
        data,
        phone
      );
    } catch (error) {
      if (MessageUpsertDlqConsume.isTerminalPayloadError(error)) {
        return;
      }

      console.error('Error processing DLQ message once, discarding:', {
        error,
        account_id: data.account_id,
        worker_id: data.worker_id,
        message_id: data.message?.key?.id,
        dlq_error: (data as any).dlq_error,
        dlq_timestamp: (data as any).dlq_timestamp,
      });
    }
  }

  private async acquireDedupe(key: string): Promise<boolean> {
    if (!this.redis) {
      if (this.localProcessedDedupe.has(key)) {
        return false;
      }
      this.localProcessedDedupe.add(key);
      return true;
    }

    try {
      const result = await this.redis.set(
        key,
        '1',
        'EX',
        this.processedDedupeTtlSeconds,
        'NX'
      );
      return result === 'OK';
    } catch {
      if (this.localProcessedDedupe.has(key)) {
        return false;
      }
      this.localProcessedDedupe.add(key);
      return true;
    }
  }

  private resolveDlqDedupeKey(
    data: IUpsertMessage,
    fallbackKey?: string | null
  ): string {
    const kafkaKey = buildUpsertMessageDlqKey(data, fallbackKey);
    return `${this.processedDedupePrefix}:${kafkaKey}`;
  }

  private static isTerminalPayloadError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message === 'Received message without remoteJid' ||
      error.message === 'Received message without valid phone'
    );
  }
}
