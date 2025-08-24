import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { Kafka, Consumer } from 'kafkajs';

@singleton()
export class WorkerConnectionStatusConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly baileysService: BaileysService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService
  ) {}

  private parseMessage(
    value: Buffer | null
  ): StatusConnectionWorkerRequest | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StatusConnectionWorkerRequest;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    const topic = this.kafkaBaileysQueueService.workerConnection(
      baileysEnvironment.baileysWorkerId
    );

    this.consumer = this.kafka.consumer({
      groupId: `group-underchat-worker-connection-status-${baileysEnvironment.baileysWorkerId}`,
      retry: { retries: 8, initialRetryTime: 300 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);
        if (!data) return;

        if (data.status === EWorkerStatus.online) {
          await this.baileysService.connect({
            initial_connection: true,
            type: data.type as EBaileysConnectionType,
            phone_connection: data.phone_connection,
          });
          return;
        }

        if (data.status === EWorkerStatus.recreating) {
          this.baileysService.reconnect({ initial_connection: true });
          return;
        }

        if (data.status === EWorkerStatus.disponible) {
          this.baileysService.disconnect({
            initial_connection: true,
            disconnected_user: true,
          });
          return;
        }
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
