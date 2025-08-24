import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

@singleton()
export class WorkerConnectionConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly workerService: WorkerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer) {
      return;
    }

    const topic = this.getTopic();
    this.consumer = this.createConsumer();

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          return;
        }

        await this.handleMessage(data);

        return;
      },
    });

    return;
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    return;
  }

  private getTopic(): string {
    const topic = this.kafkaServiceQueueService.workerStatus();

    return topic;
  }

  private createConsumer(): Consumer {
    const consumer = this.kafka.consumer({
      groupId: 'group-underchat-worker-connection',
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
    });

    return consumer;
  }

  private parseMessage(value: Buffer | null): IBaileysConnectionState | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IBaileysConnectionState;

      return parsed ?? null;
    } catch {
      return null;
    }
  }

  private async handleMessage(data: IBaileysConnectionState): Promise<void> {
    const view = await this.workerService.viewWorkerPhoneConnectionDate(
      data.worker_id
    );

    if (!view) {
      return;
    }

    const phoneNumber = data.phone ?? view.number;

    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: data.worker_id,
      status: data.worker_status_id,
      number: phoneNumber,
      connection_date: view.connection_date,
    });

    return;
  }
}
