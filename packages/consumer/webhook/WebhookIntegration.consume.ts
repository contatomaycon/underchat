import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IWebhookIntegrationRequest } from '@core/common/interfaces/IWebhookIntegrationRequest';
import { BaileysService } from '@core/services/baileys';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { WAMessage, proto } from '@whiskeysockets/baileys';
import { v7 as uuidv7 } from 'uuid';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class WebhookIntegrationConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(BaileysService)
    private readonly baileysService: BaileysService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaBaileysQueueService.workerWebhookIntegration(
      baileysEnvironment.baileysWorkerId
    );

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    const groupId = `group-underchat-webhook-integration-${baileysEnvironment.baileysWorkerId}`;
    this.consumer = createConsumer(this.kafka, groupId);

    this.consumer.on('data', async (message) => {
      await this.handleMessage(topic, message);
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
    await Promise.all(this.partitionChains.values());
    this.partitionChains.clear();

    if (this.consumer) {
      this.consumer.disconnect();
      this.consumer = null;
    }

    this.isRunning = false;
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private async handleMessage(
    topic: string,
    message: { value: Buffer | null; partition: number; offset: number }
  ): Promise<void> {
    const data = this.parseMessage(message.value);
    if (!data) {
      await commitOffset(
        this.consumerOrThrow,
        topic,
        message.partition,
        message.offset
      );
      return;
    }

    const partition = message.partition;
    const offset = message.offset;
    const previousChain =
      this.partitionChains.get(partition) ?? Promise.resolve();

    const currentChain = previousChain
      .then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };
        const stop = startHeartbeat(heartbeat);

        try {
          await this.processWebhookIntegration(data);
        } finally {
          stop();
          await commitOffset(this.consumerOrThrow, topic, partition, offset);
        }
      })
      .catch(() => {});

    this.partitionChains.set(partition, currentChain);
  }

  private parseMessage(
    value: Buffer | null
  ): IWebhookIntegrationRequest | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value.toString()) as IWebhookIntegrationRequest;
    } catch {
      return null;
    }
  }

  private async processWebhookIntegration(
    data: IWebhookIntegrationRequest
  ): Promise<void> {
    const validatedJid = await this.resolveValidatedJid(data);
    const upsertMessage = this.buildUpsertMessage(data, validatedJid);

    if (!upsertMessage) {
      return;
    }

    await this.sendToMessageUpsert(upsertMessage);
  }

  private async resolveValidatedJid(
    data: IWebhookIntegrationRequest
  ): Promise<string | null> {
    if (data.contact_is_valided) {
      return null;
    }

    const result = await this.validatePhone(data.phone, data.phone_ddi);
    if (result.valid && result.jid) {
      return result.jid;
    }

    return null;
  }

  private async validatePhone(
    phone: string,
    phoneDdi: string | null
  ): Promise<{ valid: boolean; jid?: string; phone?: string }> {
    const phoneDdiToUse = phoneDdi ?? '55';
    return this.baileysService.validatePhone(phoneDdiToUse, phone);
  }

  private buildUpsertMessage(
    request: IWebhookIntegrationRequest,
    validatedJid: string | null
  ): IUpsertMessage | null {
    const remoteJid = this.resolveRemoteJid(request, validatedJid);
    if (!remoteJid) {
      return null;
    }

    const messageText = this.extractMessageText(request);
    const waMessage = this.buildWaMessage(remoteJid, messageText ?? '');

    const upsert: IUpsertMessage = {
      account_id: request.account_id,
      worker_id: request.worker_id,
      type: EMessageType.text,
      message: waMessage,
      has_quoted: false,
      is_call_event: false,
    };

    const webhookType = request.mapped_data.message_type;
    if (webhookType === 'message' || webhookType === 'chatbot') {
      upsert.webhook_message_type = webhookType;
    }

    if (request.mapped_data.chatbot_id) {
      upsert.webhook_chatbot_id = request.mapped_data.chatbot_id;
    }

    if (request.mapped_data.transfer_sector_id) {
      upsert.transfer_sector_id = request.mapped_data.transfer_sector_id;
    }

    if (request.mapped_data.transfer_sector_user_id) {
      upsert.transfer_sector_user_id =
        request.mapped_data.transfer_sector_user_id;
    }

    if (request.mapped_data.transfer_user_id) {
      upsert.transfer_user_id = request.mapped_data.transfer_user_id;
    }

    return upsert;
  }

  private resolveRemoteJid(
    request: IWebhookIntegrationRequest,
    validatedJid: string | null
  ): string | null {
    if (validatedJid) {
      return validatedJid;
    }

    if (request.contact_is_valided && request.phone_validated) {
      return (
        normalizePhoneToJid(
          request.phone_validated,
          request.phone_ddi_validated ?? null
        ) ?? null
      );
    }

    return normalizePhoneToJid(request.phone, request.phone_ddi) ?? null;
  }

  private buildWaMessage(remoteJid: string, messageText: string): WAMessage {
    return {
      key: {
        remoteJid,
        fromMe: false,
        id: uuidv7(),
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        conversation: messageText,
      } as proto.IMessage,
    };
  }

  private extractMessageText(
    request: IWebhookIntegrationRequest
  ): string | undefined {
    if (request.mapped_data.message_type === 'message') {
      return request.mapped_data.message;
    }

    if (request.mapped_data.message_type === 'chatbot') {
      const messageFromMapping = this.extractChatbotMessageFromBody(request);
      if (messageFromMapping !== undefined) {
        return messageFromMapping;
      }

      return request.mapped_data.message;
    }

    return undefined;
  }

  private extractChatbotMessageFromBody(
    request: IWebhookIntegrationRequest
  ): string | undefined {
    const messageMappingKey = request.mapping.message;
    if (!messageMappingKey || typeof messageMappingKey !== 'string') {
      return undefined;
    }

    const messageValue = this.getNestedValue(request.body, messageMappingKey);

    if (
      messageValue !== null &&
      messageValue !== undefined &&
      typeof messageValue === 'string'
    ) {
      return messageValue;
    }

    return undefined;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof current !== 'object' || current === null) {
        return null;
      }

      const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const arrayKey = arrayMatch[1];
        const arrayIndex = Number.parseInt(arrayMatch[2], 10);

        if (!(arrayKey in current)) {
          return null;
        }

        const arrayValue = (current as Record<string, unknown>)[arrayKey];
        if (!Array.isArray(arrayValue)) {
          return null;
        }

        if (arrayIndex < 0 || arrayIndex >= arrayValue.length) {
          return null;
        }

        current = arrayValue[arrayIndex];
        continue;
      }

      if (!(key in current)) {
        return null;
      }

      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  private async sendToMessageUpsert(
    upsertMessage: IUpsertMessage
  ): Promise<void> {
    const topic = this.kafkaServiceQueueService.upsertMessage();
    const messageKey = upsertMessage.message.key?.id ?? uuidv7();
    await this.streamProducerService.send(topic, upsertMessage, messageKey);
  }
}
