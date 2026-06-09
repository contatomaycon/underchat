import { singleton, inject, container } from 'tsyringe';
import type { KafkaConsumer, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { remoteJid } from '@core/common/functions/remoteJid';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';
import { TFunction } from 'i18next';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';
import { logger } from '@core/plugins/telemetry/logger';

@singleton()
export class MessageUpsertDlqConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();
  private messageUpsertConsume: MessageUpsertConsume;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {
    this.messageUpsertConsume = container.resolve(MessageUpsertConsume);
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

  public async execute(t: TFunction<'translation', undefined>): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.upsertMessageDlq();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-message-upsert-dlq'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

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
            logger.warn(
              {
                type: 'message_upsert_dlq_terminal_discarded',
                error: error instanceof Error ? error.message : String(error),
                account_id: data.account_id,
                worker_id: data.worker_id,
                message_id: data.message?.key?.id,
                dlq_error: (data as any).dlq_error,
                dlq_timestamp: (data as any).dlq_timestamp,
              },
              'Message upsert DLQ payload discarded because it cannot be reprocessed'
            );
            return;
          }

          console.error('Error processing DLQ message:', {
            error,
            account_id: data.account_id,
            worker_id: data.worker_id,
            message_id: data.message?.key?.id,
            dlq_error: (data as any).dlq_error,
            dlq_timestamp: (data as any).dlq_timestamp,
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    try {
      await commitOffset(this.consumerOrThrow, topic, partition, offset);
    } catch (error: unknown) {
      if (
        MessageUpsertDlqConsume.isLibrdKafkaError(error) &&
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
      typeof (error as { code: unknown }).code === 'number'
    );
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
