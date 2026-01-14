import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';

@singleton()
export class WorkerConnectionConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly workerService: WorkerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.getTopic();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-worker-connection`
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);
      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.handleMessage(data);
      } catch {
        await this.commitNext(topic, message.partition, message.offset);
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
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

  private getTopic(): string {
    return this.kafkaServiceQueueService.workerStatus();
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
    const isDisponibleWithDisconnectedUser =
      data.worker_status_id === EWorkerStatus.disponible &&
      data.disconnected_user === true;

    if (isDisponibleWithDisconnectedUser) {
      const inputUpdate: IUpdateWorker = {
        worker_id: data.worker_id,
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        container_id: null,
        connection_date: null,
      };

      await this.workerService.updateWorkerById(data.account_id, inputUpdate);

      return;
    }

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
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }
}
