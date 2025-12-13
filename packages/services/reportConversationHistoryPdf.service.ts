import { injectable, inject } from 'tsyringe';
import { StorageService } from './storage.service';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Environment } from '@core/config/environments';
import puppeteer from 'puppeteer';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ReportConversationHistoryPdfUpdaterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpdater.repository';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

@injectable()
export class ReportConversationHistoryPdfService {
  constructor(
    private readonly storageService: StorageService,
    @inject(ReportConversationHistoryPdfUpdaterRepository)
    private readonly pdfUpdaterRepository: ReportConversationHistoryPdfUpdaterRepository
  ) {}

  async deletePdf(url: string | null): Promise<void> {
    if (!url) {
      return;
    }

    await this.storageService.deleteImage(url);
  }

  async updateStatus(
    pdfId: string,
    status: EReportConversationHistoryPdfStatus
  ): Promise<void> {
    await this.pdfUpdaterRepository.updateStatus(pdfId, status);
  }

  async updatePdfUrl(
    pdfId: string,
    url: string,
    status: EReportConversationHistoryPdfStatus
  ): Promise<void> {
    await this.pdfUpdaterRepository.updatePdfUrl(pdfId, url, status);
  }

  async generatePdf(
    accountId: string,
    chatId: string,
    messages: ListMessageResult[]
  ): Promise<string> {
    const html = this.generateHtmlFromMessages(messages);

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

      const key = `${accountId}/report-conversation-history/${chatId}/history.pdf`;

      const s3Client = (this.storageService as any).client;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: s3Environment.s3BucketName,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        })
      );

      const url = this.storageService.createUrl(key);

      return url;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private generateHtmlFromMessages(messages: ListMessageResult[]): string {
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
