import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ReportConversationHistoryPdfUpdaterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpdater.repository';
import { ReportConversationHistoryMessagesListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryMessagesLister.useCase';
import { StorageService } from '@core/services/storage.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { IReportConversationHistoryPdfGeneratePayload } from '@core/common/interfaces/IReportConversationHistoryPdfGeneratePayload';
import { IReportConversationHistoryPdfNotification } from '@core/common/interfaces/IReportConversationHistoryPdfNotification';
import { reportConversationHistoryPdfAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import puppeteer from 'puppeteer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Environment } from '@core/config/environments';

@singleton()
export class ReportConversationHistoryPdfGenerateConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly pdfUpdaterRepository: ReportConversationHistoryPdfUpdaterRepository,
    private readonly messagesListerUseCase: ReportConversationHistoryMessagesListerUseCase,
    private readonly storageService: StorageService,
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
          await this.pdfUpdaterRepository.updateStatus(
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
    await this.pdfUpdaterRepository.updateStatus(
      data.pdf_record_id,
      EReportConversationHistoryPdfStatus.processing
    );

    const messages = await this.messagesListerUseCase.execute(
      data.account_id,
      data.chat_id
    );

    const html = this.generateHtmlFromMessages(messages.messages);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.setViewport({ width: 1200, height: 800 });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      await browser.close();

      const key = `${data.account_id}/report-conversation-history/${data.chat_id}/history.pdf`;

      const s3Client = (this.storageService as any).client;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: s3Environment.s3BucketName,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        })
      );

      const url = (this.storageService as any).createUrl(key);

      await this.pdfUpdaterRepository.updatePdfUrl(
        data.pdf_record_id,
        url,
        EReportConversationHistoryPdfStatus.done
      );

      await this.notifyPdfStatus(
        data,
        EReportConversationHistoryPdfStatus.done,
        url
      );
    } catch (error) {
      await browser.close();
      throw error;
    }
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

  private generateHtmlFromMessages(messages: any[]): string {
    const messagesHtml = messages
      .map((msg) => {
        const isUser = msg.type_user === 'user';
        const dateStr = msg.date || '';
        let formattedDate = '';

        if (dateStr) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            formattedDate = `${day}/${month}/${year} ${hours}:${minutes}`;
          }
        }

        const author = isUser ? 'Cliente' : 'Atendente';
        const content = this.formatMessageContent(msg.content);

        return `
          <div style="margin-bottom: 20px; padding: 10px; border-left: 3px solid ${isUser ? '#4CAF50' : '#2196F3'}; background: ${isUser ? '#f1f8f4' : '#f0f7ff'};">
            <div style="font-weight: bold; margin-bottom: 5px; color: ${isUser ? '#2e7d32' : '#1976d2'};">
              ${author}${formattedDate ? ` - ${formattedDate}` : ''}
            </div>
            <div style="color: #333;">
              ${content}
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <h1>Histórico de Conversas</h1>
          ${messagesHtml}
        </body>
      </html>
    `;
  }

  private formatMessageContent(content: any): string {
    if (!content) {
      return '';
    }

    if (content.type === 'text' && content.message) {
      return content.message.replace(/\n/g, '<br>');
    }

    if (content.type === 'image') {
      return `[Imagem] ${content.caption || ''}`;
    }

    if (content.type === 'video') {
      return `[Vídeo] ${content.caption || ''}`;
    }

    if (content.type === 'audio') {
      return `[Áudio]`;
    }

    if (content.type === 'document') {
      return `[Documento] ${content.filename || ''}`;
    }

    if (content.type === 'sticker') {
      return `[Sticker]`;
    }

    if (content.type === 'location') {
      return `[Localização] ${content.name || ''}`;
    }

    if (content.type === 'contact_card') {
      return `[Contato] ${content.contact?.name || ''}`;
    }

    return '[Mensagem não suportada]';
  }
}
