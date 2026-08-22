import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

@singleton()
export class PhoneValidationResponseConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IPhoneValidationResponse> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(WhatsappRuntimeFenceService)
    private readonly runtimeFence: WhatsappRuntimeFenceService
  ) {}

  private parseMessage(value: Buffer | null): IPhoneValidationResponse | null {
    if (!value) return null;

    try {
      return JSON.parse(value.toString()) as IPhoneValidationResponse;
    } catch {
      return null;
    }
  }

  private async processResponse(
    data: IPhoneValidationResponse,
    assertActive: () => void = () => undefined
  ): Promise<void> {
    const cacheKey = `phone_validation:${data.request_id}`;
    assertActive();
    const stored = await this.runtimeFence.setValueIfCurrent(
      data,
      cacheKey,
      JSON.stringify(data),
      30
    );
    if (!stored) {
      return;
    }
    assertActive();
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.phoneValidationResponse();
    this.runner = new KafkaConsumerRunner<IPhoneValidationResponse>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.phoneValidationResponse,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.request_id,
      preserveEntityOrder: true,
      acquireEffectLease: (data) => this.runtimeFence.acquireEffectLease(data),
      classifyEffectLeaseRejection: async (data) =>
        (await this.runtimeFence.isCurrent(data)) ? 'retry' : 'terminal',
      handle: (data, context) =>
        this.processResponse(data, context.assertActive),
      maxRetries: 3,
      retryDelaysMs: [250, 1_000, 3_000],
      shouldContinueRetryWithoutCommit: () => true,
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
