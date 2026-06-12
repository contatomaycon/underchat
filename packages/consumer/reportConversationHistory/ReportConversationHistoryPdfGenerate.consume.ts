import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ReportConversationHistoryPdfService } from '@core/services/reportConversationHistoryPdf.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { IReportConversationHistoryPdfGeneratePayload } from '@core/common/interfaces/IReportConversationHistoryPdfGeneratePayload';
import { IReportConversationHistoryPdfNotification } from '@core/common/interfaces/IReportConversationHistoryPdfNotification';
import { reportConversationHistoryPdfAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { createI18nInstance } from '@core/common/functions/createI18nInstance';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ReportConversationHistoryPdfGenerateConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IReportConversationHistoryPdfGeneratePayload> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ReportConversationHistoryPdfService)
    private readonly pdfService: ReportConversationHistoryPdfService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic =
      this.kafkaServiceQueueService.reportConversationHistoryPdfGenerate();
    this.runner =
      new KafkaConsumerRunner<IReportConversationHistoryPdfGeneratePayload>({
        kafka: this.kafka,
        topic,
        groupId: 'group-underchat-report-conversation-history-pdf-generate',
        parse: (message) => this.parseMessage(message.value),
        resolveEntityKey: (data) => data.pdf_record_id,
        handle: async (data) => {
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
          }
        },
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

  private async handleMessage(
    data: IReportConversationHistoryPdfGeneratePayload
  ): Promise<void> {
    await this.pdfService.updateStatus(
      data.pdf_record_id,
      EReportConversationHistoryPdfStatus.processing
    );

    if (data.old_url_pdf) {
      try {
        await this.pdfService.deletePdf(data.old_url_pdf);
      } catch (error) {
        console.warn(
          'Failed to delete previous conversation history PDF, continuing generation:',
          {
            pdf_record_id: data.pdf_record_id,
            old_url_pdf: data.old_url_pdf,
            error,
          }
        );
      }
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
