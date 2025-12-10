import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class ProfileStatusExternalIdUpdateConsume {
  private consumer: Consumer | null = null;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

  private get consumerOrThrow(): Consumer {
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
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-profile-status-external-id-update'
    );

    const topic = this.kafkaServiceQueueService.updateProfileStatusExternalId();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const offset = message.offset;

        this.processingChain = this.processingChain.then(async () => {
          const stop = startHeartbeat(heartbeat);

          try {
            await this.processUpdate(data);
          } catch {
            await this.commitNext(topic, partition, message.offset);
          } finally {
            stop();
          }

          await this.commitNext(topic, partition, offset);
        });
      },
    });
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    await this.consumerOrThrow.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + BigInt(1)).toString(),
      },
    ]);
  }

  public async close(): Promise<void> {
    await this.processingChain;

    if (!this.consumer) {
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
  }
}
