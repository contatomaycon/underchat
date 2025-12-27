import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IScheduleMessage } from '@core/common/interfaces/IScheduleMessage';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { BaileysMessageMediaService } from '@core/services/baileys/methods/messageMedia.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { selectJidChat } from '@core/common/functions/selectJidChat';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';

@singleton()
export class ScheduleMessageConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly streamProducerService: StreamProducerService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly baileysMessageMediaService: BaileysMessageMediaService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-schedule-message'
    );

    const topic = this.kafkaServiceQueueService.scheduleMessage();

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
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
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

  private async handleMessage(data: IScheduleMessage): Promise<void> {
    const delay = data.message?.send_delay_ms;
    if (delay && typeof delay === 'number' && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const jid = selectJidChat(data.message);

    if (!jid) {
      throw new Error('Received message without remoteJid');
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
    const result = await this.baileysMessageTextService.sendText(
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
  }

  private async processImage(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const imageUrl = data.message.content?.image?.url;

    if (!imageUrl) {
      throw new Error('Image URL is required');
    }

    const result = await this.baileysMessageMediaService.sendImage(
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
  }

  private async processVideo(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const video = data.message.content?.video;

    if (!video?.url) {
      throw new Error('Video URL is required');
    }

    const result = await this.baileysMessageMediaService.sendVideo(
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
  }

  private async processAudio(
    jid: string,
    data: IScheduleMessage
  ): Promise<void> {
    const audio = data.message.content?.audio;

    if (!audio?.url) {
      throw new Error('Audio URL is required');
    }

    const result = await this.baileysMessageMediaService.sendAudio(
      jid,
      { url: audio.url },
      {
        ptt: audio.ptt ?? false,
        seconds: audio.duration ?? undefined,
        mimetype: audio.mimetype ?? undefined,
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
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();
    await this.streamProducerService.send(topic, input);
  }

  private async sendStatusUpdate(
    scheduleId: string,
    contactId: string,
    messageId: string,
    status: EScheduleStatus.sent | EScheduleStatus.failed
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
}
