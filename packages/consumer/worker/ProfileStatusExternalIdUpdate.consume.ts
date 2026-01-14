import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class ProfileStatusExternalIdUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(
    value: Buffer | null
  ): IUpdateProfileStatusExternalId | null {
    if (!value) return null;

    try {
      const parsed = JSON.parse(
        value.toString()
      ) as IUpdateProfileStatusExternalId;

      if (
        'worker_profile_status_id' in parsed &&
        'external_id' in parsed &&
        typeof parsed.worker_profile_status_id === 'string' &&
        typeof parsed.external_id === 'string'
      ) {
        return parsed;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async processUpdate(
    data: IUpdateProfileStatusExternalId
  ): Promise<void> {
    await this.workerProfileStatusService.updateExternalId(
      data.worker_profile_status_id,
      data.external_id
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.updateProfileStatusExternalId();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-profile-status-external-id-update'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const offset = message.offset;

      this.processingChain = this.processingChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.processUpdate(data);
        } catch {
          await this.commitNext(topic, message.partition, message.offset);
        } finally {
          stop();
        }

        await this.commitNext(topic, message.partition, offset);
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
  }

  public async close(): Promise<void> {
    await this.processingChain;

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
    }
  }
}
