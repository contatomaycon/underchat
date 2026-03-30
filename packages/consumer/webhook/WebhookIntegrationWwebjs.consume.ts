import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { wwebjsEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IWebhookIntegrationRequest } from '@core/common/interfaces/IWebhookIntegrationRequest';
import { WwebjsService } from '@core/services/wwebjs';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { v7 as uuidv7 } from 'uuid';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { IContactValidationUpdate } from '@core/common/interfaces/IContactValidationUpdate';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import {
  resolveWebhookInteractionJids,
  type IWebhookInteractionJids,
} from '@core/common/functions/resolveWebhookInteractionJids';

@singleton()
export class WebhookIntegrationWwebjsConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private partitionChains: Map<number, Promise<void>> = new Map();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(WwebjsService)
    private readonly wwebjsService: WwebjsService,
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
      wwebjsEnvironment.wwebjsWorkerId
    );

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    const groupId = `group-underchat-webhook-integration-wwebjs-${wwebjsEnvironment.wwebjsWorkerId}`;
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
    const resolvedJids = await this.resolveRemoteJidForInteraction(data);
    if (!resolvedJids) {
      return;
    }

    const upsertMessage = this.buildUpsertMessage(data, resolvedJids);

    if (!upsertMessage) {
      return;
    }

    await this.sendToMessageUpsert(upsertMessage);
  }

  private async validatePhone(
    phone: string,
    phoneDdi: string | null
  ): Promise<{ valid: boolean; jid?: string; phone?: string }> {
    const phoneDdiToUse = phoneDdi ?? '55';
    return this.wwebjsService.validatePhone(phoneDdiToUse, phone);
  }

  private isLidJid(jid?: string | null): boolean {
    return !!jid && jid.endsWith('@lid');
  }

  private buildValidationCandidates(
    request: IWebhookIntegrationRequest
  ): Array<{ phone: string; phoneDdi: string; phoneWithDdi: string }> {
    const candidates: Array<{
      phone: string;
      phoneDdi: string;
      phoneWithDdi: string;
    }> = [];
    const seen = new Set<string>();

    const addCandidate = (
      phone: string | null | undefined,
      phoneDdi: string | null | undefined
    ) => {
      if (!phone) {
        return;
      }

      const normalizedPhone = onlyDigits(phone);
      if (!normalizedPhone) {
        return;
      }

      const normalizedDdi = onlyDigits(phoneDdi ?? '55') || '55';
      const phoneWithDdi = `${normalizedDdi}${normalizedPhone}`;
      if (seen.has(phoneWithDdi)) {
        return;
      }

      seen.add(phoneWithDdi);
      candidates.push({
        phone: normalizedPhone,
        phoneDdi: normalizedDdi,
        phoneWithDdi,
      });
    };

    addCandidate(request.phone, request.phone_ddi);
    addCandidate(request.phone_validated, request.phone_ddi_validated);

    return candidates;
  }

  private resolveValidatedPhoneWithDdi(
    result: { jid?: string; phone?: string },
    fallbackPhoneWithDdi: string
  ): string {
    if (result.phone) {
      const extracted = extractPhoneAndDdi(result.phone);
      if (extracted) {
        return `${extracted.phone_ddi}${extracted.phone}`;
      }
    }

    if (!this.isLidJid(result.jid)) {
      const phoneFromJid = getPhoneFromJid(result.jid, null);
      if (phoneFromJid) {
        const extracted = extractPhoneAndDdi(phoneFromJid);
        if (extracted) {
          return `${extracted.phone_ddi}${extracted.phone}`;
        }
      }
    }

    return fallbackPhoneWithDdi;
  }

  private getFallbackCandidate(
    request: IWebhookIntegrationRequest
  ): { phone: string; phoneDdi: string; phoneWithDdi: string } | null {
    const [firstCandidate] = this.buildValidationCandidates(request);
    return firstCandidate ?? null;
  }

  private buildPhoneWithDdi(
    phone: string | null | undefined,
    phoneDdi: string | null | undefined
  ): string {
    return `${phoneDdi ?? '55'}${phone ?? ''}`;
  }

  private isTechnicalValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('deadline exceeded') ||
      errorMessage.includes('no active worker') ||
      errorMessage.includes('disconnected') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('unavailable') ||
      errorMessage.includes('not connected')
    );
  }

  private isInvalidValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('phone_number_not_valid_on_whatsapp') ||
      errorMessage.includes('phone number is not valid on whatsapp')
    );
  }

  private shouldPublishSuccessContactUpdate(
    request: IWebhookIntegrationRequest,
    validatedPhoneWithDdi: string
  ): boolean {
    if (!request.contact_is_valided) {
      return true;
    }

    const currentPhoneWithDdi = request.phone_validated
      ? this.buildPhoneWithDdi(
          request.phone_validated,
          request.phone_ddi_validated
        )
      : this.buildPhoneWithDdi(request.phone, request.phone_ddi);

    return (
      onlyDigits(currentPhoneWithDdi) !== onlyDigits(validatedPhoneWithDdi)
    );
  }

  private async publishContactValidationUpdate(
    contactId: string,
    phoneWithDdi: string,
    isValidated: boolean
  ): Promise<void> {
    if (!contactId?.trim()) {
      return;
    }

    const payload: IContactValidationUpdate = {
      contact_id: contactId,
      phone: phoneWithDdi,
      is_validated: isValidated,
    };

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    await this.streamProducerService.send(topic, payload);
  }

  private async resolveRemoteJidForInteraction(
    request: IWebhookIntegrationRequest
  ): Promise<IWebhookInteractionJids | null> {
    const candidates = this.buildValidationCandidates(request);
    if (!candidates.length) {
      return null;
    }

    let hasInvalidPhone = false;

    for (const candidate of candidates) {
      try {
        const result = await this.validatePhone(
          candidate.phone,
          candidate.phoneDdi
        );

        if (!result.valid) {
          hasInvalidPhone = true;
          continue;
        }

        const validatedPhoneWithDdi = this.resolveValidatedPhoneWithDdi(
          result,
          candidate.phoneWithDdi
        );

        if (
          this.shouldPublishSuccessContactUpdate(request, validatedPhoneWithDdi)
        ) {
          await this.publishContactValidationUpdate(
            request.contact_id,
            validatedPhoneWithDdi,
            true
          );
        }

        const resolvedJids = resolveWebhookInteractionJids({
          validatedJid: result.jid ?? null,
          validatedPhoneWithDdi,
          fallbackPhone: candidate.phone,
          fallbackPhoneDdi: candidate.phoneDdi,
        });

        if (resolvedJids) {
          return resolvedJids;
        }
      } catch (error) {
        if (this.isInvalidValidationError(error)) {
          hasInvalidPhone = true;
          continue;
        }

        if (this.isTechnicalValidationError(error)) {
          continue;
        }

        return null;
      }
    }

    const fallbackCandidate = this.getFallbackCandidate(request);
    if (!fallbackCandidate) {
      return null;
    }

    if (hasInvalidPhone) {
      await this.publishContactValidationUpdate(
        request.contact_id,
        fallbackCandidate.phoneWithDdi,
        false
      );
    }

    return resolveWebhookInteractionJids({
      validatedPhoneWithDdi: fallbackCandidate.phoneWithDdi,
      fallbackPhone: fallbackCandidate.phone,
      fallbackPhoneDdi: fallbackCandidate.phoneDdi,
    });
  }

  private buildUpsertMessage(
    request: IWebhookIntegrationRequest,
    resolvedJids: IWebhookInteractionJids
  ): IUpsertMessage | null {
    const messageText = this.extractMessageText(request);
    const waMessage = this.buildWaMessage(
      resolvedJids.remoteJid,
      resolvedJids.remoteJidAlt,
      messageText ?? ''
    );

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

  private buildWaMessage(
    remoteJid: string,
    remoteJidAlt: string | undefined,
    messageText: string
  ): IUpsertMessage['message'] {
    return {
      key: {
        remoteJid,
        remoteJidAlt,
        fromMe: false,
        id: uuidv7(),
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: {
        conversation: messageText,
      },
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
