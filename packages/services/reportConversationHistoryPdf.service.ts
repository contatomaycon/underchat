import { injectable, inject } from 'tsyringe';
import { StorageService } from './storage.service';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Environment } from '@core/config/environments';
import puppeteer from 'puppeteer';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ReportConversationHistoryPdfUpdaterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpdater.repository';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChat } from '@core/common/interfaces/IChat';
import { ReportConversationHistoryMessagesListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryMessagesLister.useCase';

@injectable()
export class ReportConversationHistoryPdfService {
  constructor(
    private readonly storageService: StorageService,
    @inject(ReportConversationHistoryPdfUpdaterRepository)
    private readonly pdfUpdaterRepository: ReportConversationHistoryPdfUpdaterRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly messagesListerUseCase: ReportConversationHistoryMessagesListerUseCase
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

  async generatePdf(accountId: string, chatId: string): Promise<string> {
    const [chat, messagesResult] = await Promise.all([
      this.getChat(accountId, chatId),
      this.messagesListerUseCase.execute(accountId, chatId),
    ]);

    const clientName = chat?.name || chat?.contact?.name || 'Cliente';
    const html = this.generateHtmlFromMessages(
      messagesResult.messages,
      clientName
    );

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

  private async getChat(
    accountId: string,
    chatId: string
  ): Promise<IChat | null> {
    const queryElastic = {
      size: 1,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const hit = result?.hits?.hits?.[0];
    return (hit?._source as IChat) || null;
  }

  private generateHtmlFromMessages(
    messages: ListMessageResult[],
    clientName: string
  ): string {
    const parts: string[] = [];

    for (const msg of messages) {
      const isUser = msg.type_user === ETypeUserChat.client;
      const formattedDate = this.formatDate(msg.date || '');
      const author = this.getAuthorName(msg, isUser, clientName);
      const content = this.formatMessageContent(msg.content);
      const alignmentClass = isUser ? 'left' : 'right';
      const timeOnly = this.formatTimeOnly(msg.date || '');

      parts.push(`
        <div class="msg-row ${alignmentClass}">
          <div class="msg-name">${author}</div>
          <div class="bubble ${alignmentClass}">
            <div class="content">${content}</div>
            <div class="meta">
              <span class="time">${timeOnly}</span>
            </div>
          </div>
        </div>
      `);
    }

    const messagesHtml = parts.join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; background: #f4f5f7; }
            .chat-log { display: flex; flex-direction: column; gap: 8px; }
            .msg-row { display: flex; width: 100%; align-items: flex-start; gap: 8px; }
            .msg-row.left { justify-content: flex-start; }
            .msg-row.right { justify-content: flex-end; }
            .msg-name { font-size: 11px; color: rgba(17,27,33,0.6); white-space: nowrap; padding-top: 2px; font-weight: 500; }
            .msg-row.left .msg-name { order: 1; }
            .msg-row.right .msg-name { order: 3; }
            .bubble { max-width: 65%; width: fit-content; padding: 8px 12px 20px 12px; border-radius: 8px; position: relative; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .msg-row.left .bubble { order: 2; background: rgb(255, 255, 255); color: #111b21; }
            .msg-row.right .bubble { order: 2; background: rgb(217, 253, 211); color: #111b21; }
            .content { font-size: 14.2px; word-break: break-word; margin-bottom: 4px; }
            .meta { position: absolute; right: 8px; bottom: 4px; display: flex; gap: 4px; align-items: center; font-size: 11px; color: rgba(17,27,33,0.6); }
            .time { font-weight: 500; }
          </style>
        </head>
        <body>
          <h1>Histórico de Conversas</h1>
          <div class="chat-log">
            ${messagesHtml}
          </div>
        </body>
      </html>
    `;
  }

  private getAuthorName(
    msg: ListMessageResult,
    isUser: boolean,
    clientName: string
  ): string {
    if (isUser) {
      return clientName;
    }

    return msg.user?.name || 'Operador';
  }

  private formatTimeOnly(dateStr: string): string {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '';
    }

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) {
      return '';
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '';
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
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
