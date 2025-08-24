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

  private parseMessage(value: Buffer | null): IBaileysConnectionState | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IBaileysConnectionState;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    const topic = this.kafkaServiceQueueService.workerStatus();

    this.consumer = this.kafka.consumer({
      groupId: 'group-underchat-worker-connection',
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);
        if (!data) return;

        const viewWorkerPhoneConnectionDate =
          await this.workerService.viewWorkerPhoneConnectionDate(
            data.worker_id
          );

        if (!viewWorkerPhoneConnectionDate) return;

        const phoneNumber = data.phone ?? viewWorkerPhoneConnectionDate.number;

        await this.workerService.updateWorkerPhoneStatusConnectionDate({
          worker_id: data.worker_id,
          status: data.worker_status_id,
          number: phoneNumber,
          connection_date: viewWorkerPhoneConnectionDate.connection_date,
        });
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;
    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}
