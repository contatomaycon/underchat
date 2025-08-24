import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { Kafka, Consumer } from 'kafkajs';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';

@singleton()
export class WorkerConnectionStatusConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly baileysService: BaileysService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService
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

    const topic = this.getWorkerConnectionTopic();
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
          await this.handleConnectionStatus(data);
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

  private getWorkerConnectionTopic(): string {
    const topic = this.kafkaBaileysQueueService.workerConnection(
      baileysEnvironment.baileysWorkerId
    );

    return topic;
  }

  private createConsumer(): Consumer {
    const consumer = this.kafka.consumer({
      groupId: `group-underchat-worker-connection-status-${baileysEnvironment.baileysWorkerId}`,
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
      sessionTimeout: 900_000,
      rebalanceTimeout: 1_200_000,
      heartbeatInterval: 3_000,
    });

    return consumer;
  }

  private parseMessage(
    value: Buffer | null
  ): StatusConnectionWorkerRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StatusConnectionWorkerRequest;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  private async handleConnectionStatus(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    if (data.status === EWorkerStatus.online) {
      await this.handleOnline(data);

      return;
    }

    if (data.status === EWorkerStatus.recreating) {
      this.handleRecreating();

      return;
    }

    if (data.status === EWorkerStatus.disponible) {
      this.handleDisponible();

      return;
    }

    return;
  }

  private async handleOnline(
    data: StatusConnectionWorkerRequest
  ): Promise<void> {
    await this.baileysService.connect({
      initial_connection: true,
      type: data.type as EBaileysConnectionType,
      phone_connection: data.phone_connection,
    });
  }

  private handleRecreating(): void {
    this.baileysService.reconnect({ initial_connection: true });
  }

  private handleDisponible(): void {
    this.baileysService.disconnect({
      initial_connection: true,
      disconnected_user: true,
    });
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
