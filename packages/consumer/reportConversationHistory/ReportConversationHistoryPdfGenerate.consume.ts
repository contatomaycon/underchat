import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ReportConversationHistoryMessagesListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryMessagesLister.useCase';
import { ReportConversationHistoryPdfService } from '@core/services/reportConversationHistoryPdf.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { IReportConversationHistoryPdfGeneratePayload } from '@core/common/interfaces/IReportConversationHistoryPdfGeneratePayload';
import { IReportConversationHistoryPdfNotification } from '@core/common/interfaces/IReportConversationHistoryPdfNotification';
import { reportConversationHistoryPdfAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

@singleton()
export class ReportConversationHistoryPdfGenerateConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly messagesListerUseCase: ReportConversationHistoryMessagesListerUseCase,
    private readonly pdfService: ReportConversationHistoryPdfService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-report-conversation-history-pdf-generate'
    );

    const topic =
      this.kafkaServiceQueueService.reportConversationHistoryPdfGenerate();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

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

        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.disconnect();
    this.consumer = null;
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
    offset: string
  ): Promise<void> {
    await this.consumerOrThrow.commitOffsets([
      {
        topic,
        partition,
        offset: (BigInt(offset) + BigInt(1)).toString(),
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

    const messages = await this.messagesListerUseCase.execute(
      data.account_id,
      data.chat_id
    );

    const url = await this.pdfService.generatePdf(
      data.account_id,
      data.chat_id,
      messages.messages
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
