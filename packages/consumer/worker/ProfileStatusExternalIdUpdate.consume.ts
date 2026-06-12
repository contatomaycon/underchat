import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateProfileStatusExternalId } from '@core/common/interfaces/IUpdateProfileStatusExternalId';
import { WorkerProfileStatusService } from '@core/services/workerProfileStatus.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ProfileStatusExternalIdUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IUpdateProfileStatusExternalId> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WorkerProfileStatusService)
    private readonly workerProfileStatusService: WorkerProfileStatusService
  ) {}

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
    this.runner = new KafkaConsumerRunner<IUpdateProfileStatusExternalId>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-profile-status-external-id-update',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.worker_profile_status_id,
      handle: (data) => this.processUpdate(data),
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
}
