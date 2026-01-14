import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ReportConversationHistoryPdfService } from '@core/services/reportConversationHistoryPdf.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { IReportConversationHistoryPdfGeneratePayload } from '@core/common/interfaces/IReportConversationHistoryPdfGeneratePayload';
import { IReportConversationHistoryPdfNotification } from '@core/common/interfaces/IReportConversationHistoryPdfNotification';
import { reportConversationHistoryPdfAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

@singleton()
export class ReportConversationHistoryPdfGenerateConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly pdfService: ReportConversationHistoryPdfService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic =
      this.kafkaServiceQueueService.reportConversationHistoryPdfGenerate();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-report-conversation-history-pdf-generate'
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
      } catch (error) {
        console.error('Error processing PDF generation:', error);
        await this.pdfService.updateStatus(
          data.pdf_record_id,
          EReportConversationHistoryPdfStatus.failed
        );
        await this.notifyPdfStatus(
          data,
          EReportConversationHistoryPdfStatus.failed
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

  private parseMessage(
    value: Buffer | null
  ): IReportConversationHistoryPdfGeneratePayload | null {
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(
        value.toString()
      ) as IReportConversationHistoryPdfGeneratePayload;
    } catch {
      return null;
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

  private async handleMessage(
    data: IReportConversationHistoryPdfGeneratePayload
  ): Promise<void> {
    await this.pdfService.updateStatus(
      data.pdf_record_id,
      EReportConversationHistoryPdfStatus.processing
    );

    if (data.old_url_pdf) {
      await this.pdfService.deletePdf(data.old_url_pdf);
    }

    const t = await createI18nInstance(data.language || 'pt');

    const url = await this.pdfService.generatePdf(
      data.account_id,
      data.chat_id,
      t
    );

    await this.pdfService.updatePdfUrl(
      data.pdf_record_id,
      url,
      EReportConversationHistoryPdfStatus.done
    );

    await this.notifyPdfStatus(
      data,
      EReportConversationHistoryPdfStatus.done,
      url
    );
  }

  private async notifyPdfStatus(
    data: IReportConversationHistoryPdfGeneratePayload,
    status: EReportConversationHistoryPdfStatus,
    url?: string
  ): Promise<void> {
    try {
      const notification: IReportConversationHistoryPdfNotification = {
        chat_id: data.chat_id,
        pdf_id: data.pdf_record_id,
        status,
        url_pdf: url ?? null,
      };

      const channel = reportConversationHistoryPdfAccountCentrifugo(
        data.account_id
      );

      await this.centrifugoService.publishSub(channel, notification);
    } catch (error) {
      console.error('Error sending PDF status notification:', error);
    }
  }
}
