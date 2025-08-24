import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';

@singleton()
export class WorkerConnectionConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly workerService: WorkerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) {
      return;
    }

    const topic = this.getTopic();
    const consumer = this.createConsumer();

    this.consumer = consumer;

    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });

    await consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);
        if (!data) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.handleMessage(data);
        } finally {
          stop();
        }

        await this.commitNext(topic, partition, message.offset);

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
    return this.kafkaServiceQueueService.workerStatus();
  }

  private createConsumer(): Consumer {
    const consumer = this.kafka.consumer({
      groupId: 'group-underchat-worker-connection',
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
      sessionTimeout: 900_000,
      rebalanceTimeout: 1_200_000,
      heartbeatInterval: 3_000,
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    const next = (BigInt(offset) + 1n).toString();

    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: next },
    ]);
  }
}
