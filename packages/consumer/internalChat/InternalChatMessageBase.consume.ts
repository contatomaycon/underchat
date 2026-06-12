import { inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { InternalChatCommandDispatcherService } from '@core/services/internalChatCommandDispatcher.service';
import { IInternalChatDispatchMessage } from '@core/common/interfaces/internalChat/IInternalChatDispatchMessage';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

export abstract class InternalChatMessageBaseConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IInternalChatDispatchMessage> | null =
    null;
  private isRunning = false;

  protected abstract getTopic(
    kafkaServiceQueueService: KafkaServiceQueueService
  ): string;
  protected abstract getGroupId(): string;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(InternalChatCommandDispatcherService)
    private readonly dispatcher: InternalChatCommandDispatcherService
  ) {}

  private parseMessage(
    value: Buffer | null
  ): IInternalChatDispatchMessage | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as IInternalChatDispatchMessage | null;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.getTopic(this.kafkaServiceQueueService);
    this.runner = new KafkaConsumerRunner<IInternalChatDispatchMessage>({
      kafka: this.kafka,
      topic,
      groupId: this.getGroupId(),
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        `${data.message.account_id}:${data.message.conversation_id}`,
      handle: (data) => this.dispatcher.dispatchMessage(data),
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
