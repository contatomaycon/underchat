import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IWorkerConfigUpdateEvent } from '@core/common/interfaces/IWorkerConfigUpdateEvent';
import { BaileysIncomingMessageService } from '@core/services/baileys/methods/incoming.service';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class WorkerConfigUpdateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IWorkerConfigUpdateEvent> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(BaileysIncomingMessageService)
    private readonly baileysIncomingMessageService: BaileysIncomingMessageService
  ) {}

  private parseMessage(value: Buffer | null): IWorkerConfigUpdateEvent | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IWorkerConfigUpdateEvent;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.workerConfigUpdate();
    this.runner = new KafkaConsumerRunner<IWorkerConfigUpdateEvent>({
      kafka: this.kafka,
      topic,
      groupId: `group-underchat-worker-config-update-${baileysEnvironment.baileysWorkerId}`,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.worker_id,
      handle: async (data) => {
        if (data.worker_id !== baileysEnvironment.baileysWorkerId) {
          return;
        }

        const rejectCall = data.reject_call ?? false;
        this.baileysIncomingMessageService.updateRejectCallConfig(rejectCall);
      },
      onInvalidMessage: () => {
        console.warn('Skipping invalid worker config update payload');
      },
      onFailed: (_payload, _context, error) => {
        console.error('Error updating worker config:', error);
      },
      maxRetries: 3,
      retryDelaysMs: [250, 1000],
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
