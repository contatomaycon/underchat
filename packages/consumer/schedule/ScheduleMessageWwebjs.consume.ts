import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';
import { WwebjsMessageMediaService } from '@core/services/wwebjs/methods/messageMedia.service';
import { WwebjsPhoneValidationService } from '@core/services/wwebjs/methods/phoneValidation.service';
import { IContactValidationUpdate } from '@core/common/interfaces/IContactValidationUpdate';
import { EMessageType } from '@core/common/enums/EMessageType';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { withLock } from '@core/common/functions/withLock';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import Redis from 'ioredis';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { onlyDigits } from '@core/common/functions/onlyDigits';

@singleton()
export class ScheduleMessageWwebjsConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject('Redis') private readonly redis: Redis,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(WwebjsMessageTextService)
    private readonly wwebjsMessageTextService: WwebjsMessageTextService,
    @inject(WwebjsMessageMediaService)
    private readonly wwebjsMessageMediaService: WwebjsMessageMediaService,
    @inject(WwebjsPhoneValidationService)
    private readonly wwebjsPhoneValidationService: WwebjsPhoneValidationService,
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const workerId = wwebjsEnvironment.wwebjsWorkerId;
    const topic =
      this.kafkaBaileysQueueService.workerScheduleSendMessage(workerId);
    const groupId = `group-underchat-schedule-message-wwebjs-${workerId}`;

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaBaileysQueueService.getNumPartitions(),
      this.kafkaBaileysQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(this.kafka, groupId);

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
        await withLock(
          this.redis,
          `schedule:send:${workerId}`,
          () => this.handleMessage(data),
          { ttlMs: 300000, retryMs: 500 }
        );
      } catch (error) {
        console.error(
          `Error processing schedule message for schedule ${data.schedule_id}, contact ${data.contact_id}:`,
          error
        );

        await this.sendStatusUpdate(
          data.schedule_id,
          data.contact_id,
          data.message.message_id,
          EScheduleStatus.failed
        );
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private parseMessage(value: Buffer | null): IScheduleMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IScheduleMessage;
      if (
        parsed &&
        'schedule_id' in parsed &&
        'contact_id' in parsed &&
        'message' in parsed
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private buildPhoneWithDdi(
    phone: string | null | undefined,
    phoneDdi: string | null | undefined
  ): string {
    const ddi = phoneDdi || '55';
    return `${ddi}${phone ?? ''}`;
  }

  private isTechnicalValidationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const errorMessage = error.message.toLowerCase();
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('deadline exceeded') ||
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

  private shouldPublishValidationSuccessUpdate(
    data: IScheduleMessage,
    validatedPhoneWithDdi: string
  ): boolean {
    if (!data.is_validated) {
      return true;
    }

    const currentPhoneWithDdi = this.buildPhoneWithDdi(
      data.message.phone,
      data.message.phone_ddi
    );

    return (
      onlyDigits(currentPhoneWithDdi) !== onlyDigits(validatedPhoneWithDdi)
    );
  }

  private async publishContactValidationUpdate(
    contactId: string,
    phoneWithDdi: string,
    isValidated: boolean
  ): Promise<void> {
    const contactUpdate: IContactValidationUpdate = {
      contact_id: contactId,
      phone: phoneWithDdi,
      is_validated: isValidated,
    };

    const topic = this.kafkaServiceQueueService.contactValidationUpdate();
    await this.streamProducerService.send(topic, contactUpdate);
  }

  private async resolveValidatedJid(
    data: IScheduleMessage,
    fallbackJid: string
  ): Promise<string | null> {
    const phone = data.message.phone;
    const phoneDdi = data.message.phone_ddi || '55';

    if (!phone) {
      if (data.is_validated) {
        return fallbackJid;
      }
      return null;
    }

    const fallbackPhoneWithDdi = this.buildPhoneWithDdi(phone, phoneDdi);
    const maxRetries = 3;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const validationResult =
          await this.wwebjsPhoneValidationService.validatePhone(
            phoneDdi,
            phone
          );

        if (!validationResult.valid) {
          await this.publishContactValidationUpdate(
            data.contact_id,
            fallbackPhoneWithDdi,
            false
          );
          return null;
        }

        const normalizedFromResponse = validationResult.phone
          ? extractPhoneAndDdi(validationResult.phone)
          : null;
        const validatedPhoneWithDdi = normalizedFromResponse
          ? `${normalizedFromResponse.phone_ddi}${normalizedFromResponse.phone}`
          : validationResult.phone ||
            getPhoneFromJid(validationResult.jid, null) ||
            fallbackPhoneWithDdi;

        let validatedJid = validationResult.jid ?? null;
        if (!validatedJid && normalizedFromResponse) {
          validatedJid =
            normalizePhoneToJid(
              normalizedFromResponse.phone,
              normalizedFromResponse.phone_ddi
            ) ?? null;
        }

        const jidToUse = validatedJid ?? fallbackJid;
        if (!jidToUse) {
          return null;
        }

        if (
          this.shouldPublishValidationSuccessUpdate(data, validatedPhoneWithDdi)
        ) {
          await this.publishContactValidationUpdate(
            data.contact_id,
            validatedPhoneWithDdi,
            true
          );
        }

        return jidToUse;
      } catch (error) {
        lastError = error;

        if (this.isInvalidValidationError(error)) {
          await this.publishContactValidationUpdate(
            data.contact_id,
            fallbackPhoneWithDdi,
            false
          );
          return null;
        }

        if (this.isTechnicalValidationError(error) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        break;
      }
    }

    if (lastError instanceof Error) {
      console.warn(
        `[ScheduleMessageWwebjsConsume] Phone validation failed after ${maxRetries} attempts for contact ${data.contact_id}: ${lastError.message}`
      );
    }

    if (data.is_validated) {
      return fallbackJid;
    }

    return null;
  }

  private async handleMessage(data: IScheduleMessage): Promise<void> {
    const delay = data.message?.send_delay_ms;
    if (delay && typeof delay === 'number' && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const fallbackJid = selectJidChat(data.message);

    if (!fallbackJid) {
      throw new Error('Received message without remoteJid');
    }

    const jid = await this.resolveValidatedJid(data, fallbackJid);
    if (!jid) {
      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.ignored
      );
      return;
    }

    const messageType = data.message.content?.type;

    if (!messageType) {
      throw new Error('Message type is required');
    }

    try {
      if (messageType === EMessageType.text) {
        await this.processText(jid, data);
        return;
      }

      if (messageType === EMessageType.image) {
        await this.processImage(jid, data);
        return;
      }

      if (messageType === EMessageType.video) {
        await this.processVideo(jid, data);
        return;
      }

      if (messageType === EMessageType.audio) {
        await this.processAudio(jid, data);
        return;
      }

      throw new Error(`Unsupported message type: ${messageType}`);
    } catch (error) {
      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.failed
      );
      throw error;
    }
  }

  private async processText(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    let result = null;
    let error: string | null = null;

    try {
      result = await this.wwebjsMessageTextService.sendText(
        jid,
        data.message.content?.message ?? ''
      );

      if (!result) {
        throw new Error('Failed to send text message');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdate(update);

      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await this.sendSendLog(data, jid, null, error, false);
      throw err;
    }
  }

  private async processImage(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const imageUrl = data.message.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      result = await this.wwebjsMessageMediaService.sendImage(
        jid,
        { url: imageUrl },
        {
          caption: data.message.content?.image?.caption ?? undefined,
        }
      );

      if (!result) {
        throw new Error('Failed to send image');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdate(update);

      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await this.sendSendLog(data, jid, null, error, false);
      throw err;
    }
  }

  private async processVideo(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const video = data.message.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      result = await this.wwebjsMessageMediaService.sendVideo(
        jid,
        { url: video.url },
        {
          caption: video.caption ?? data.message.content?.message ?? undefined,
          seconds: data.message.content?.video?.duration ?? undefined,
        }
      );

      if (!result) {
        throw new Error('Failed to send video');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdate(update);

      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await this.sendSendLog(data, jid, null, error, false);
      throw err;
    }
  }

  private async processAudio(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const audio = data.message.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    let result = null;
    let error: string | null = null;

    try {
      result = await this.wwebjsMessageMediaService.sendAudio(
        jid,
        { url: audio.url },
        {
          ptt: audio.ptt ?? false,
          seconds: audio.duration ?? undefined,
          mimetype: audio.mimetype ?? undefined,
          viewOnce:
            data.message.message_key?.is_view_once ?? audio.view_once ?? false,
        }
      );

      if (!result) {
        throw new Error('Failed to send audio');
      }

      const update: IUpdateMessage = { message: result, data: data.message };
      await this.pushUpdate(update);

      await this.sendStatusUpdate(
        data.schedule_id,
        data.contact_id,
        data.message.message_id,
        EScheduleStatus.sent
      );

      await this.sendSendLog(data, jid, result, null, true);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await this.sendSendLog(data, jid, null, error, false);
      throw err;
    }
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    await this.streamProducerService.send(topic, input);
  }

  private async sendStatusUpdate(
    scheduleId: string,
    contactId: string,
    messageId: string,
    status:
      | EScheduleStatus.sent
      | EScheduleStatus.failed
      | EScheduleStatus.ignored
  ): Promise<void> {
    const statusUpdate: IScheduleStatusUpdate = {
      schedule_id: scheduleId,
      contact_id: contactId,
      message_id: messageId,
      status,
    };

    const topic = this.kafkaServiceQueueService.scheduleStatusUpdate();
    await this.streamProducerService.send(topic, statusUpdate);
  }

  private async sendSendLog(
    data: IScheduleMessage,
    jid: string,
    result: any,
    error: string | null,
    success: boolean
  ): Promise<void> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const sendLog = {
      result: success ? result : null,
      error,
      success,
      jid,
      payload: data.message.content,
    };

    try {
      await this.elasticDatabaseService.updateField(
        EElasticIndex.schedule,
        data.message.message_id,
        'send_log',
        sendLog,
        3
      );
    } catch (error) {
      console.error(
        `Failed to save send log for message ${data.message.message_id}:`,
        error
      );
    }
  }
}
