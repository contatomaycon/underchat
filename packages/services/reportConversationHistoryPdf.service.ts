import { injectable } from 'tsyringe';
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
    private readonly pdfUpdaterRepository: ReportConversationHistoryPdfUpdaterRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly messagesListerUseCase: ReportConversationHistoryMessagesListerUseCase
  ) {}

  async deletePdf(url: string | null): Promise<void> {
    if (!url) return;

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
    const clientPhoto = chat?.photo || chat?.contact?.photo || null;
    const html = this.generateHtmlFromMessages(
      messagesResult.messages,
      clientName,
      clientPhoto
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
    clientName: string,
    clientPhoto: string | null
  ): string {
    const parts: string[] = [];
    let lastDate: string | null = null;

    for (const msg of messages) {
      const messageDate = msg.date || '';

      if (!lastDate || !this.isSameDay(messageDate, lastDate)) {
        const separatorLabel = this.formatDateSeparator(messageDate);
        parts.push(`
          <div class="date-separator-wrapper">
            <div class="date-separator-line"></div>
            <div class="date-separator">${separatorLabel}</div>
            <div class="date-separator-line"></div>
          </div>
        `);
        lastDate = messageDate;
      }

      const isUser = msg.type_user === ETypeUserChat.client;
      const author = this.getAuthorName(msg, isUser, clientName);
      const photo = this.getPhoto(msg, isUser, clientPhoto);
      const content = this.formatMessageContent(msg.content, msg);
      const alignmentClass = isUser ? 'left' : 'right';
      const timeOnly = this.formatTimeOnly(msg.date || '');

      parts.push(`
        <div class="msg-row ${alignmentClass}">
          <div class="msg-avatar">
            <img src="${photo}" alt="${author}" class="avatar-img" />
            <div class="msg-name">${author}</div>
          </div>
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
            .date-separator-wrapper { display: flex; justify-content: center; align-items: center; width: 100%; gap: 8px; margin: 16px 0; }
            .date-separator-line { flex: 0.25; height: 1px; background-color: rgba(17, 27, 33, 0.12); }
            .date-separator { font-size: 0.75rem; font-weight: 500; background-color: rgba(17, 27, 33, 0.12); color: rgba(17, 27, 33, 0.65); padding: 4px 12px; border-radius: 7.5px; display: inline-block; min-width: fit-content; white-space: nowrap; }
            .msg-row { display: flex; width: 100%; align-items: flex-start; gap: 8px; }
            .msg-row.left { justify-content: flex-start; }
            .msg-row.right { justify-content: flex-end; }
            .msg-avatar { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 50px; }
            .msg-row.left .msg-avatar { order: 1; }
            .msg-row.right .msg-avatar { order: 3; }
            .avatar-img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #e0e0e0; }
            .msg-name { font-size: 11px; color: rgba(17,27,33,0.6); white-space: nowrap; font-weight: 500; text-align: center; }
            .bubble { max-width: 65%; width: fit-content; padding: 8px 12px 20px 12px; border-radius: 8px; position: relative; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .msg-row.left .bubble { order: 2; background: rgb(255, 255, 255); color: #111b21; }
            .msg-row.right .bubble { order: 2; background: rgb(217, 253, 211); color: #111b21; }
            .content { font-size: 14.2px; word-break: break-word; margin-bottom: 4px; }
            .content img { max-width: 200px; max-height: 200px; width: auto; height: auto; border-radius: 8px; margin-bottom: 8px; object-fit: contain; }
            .content img.sticker-img { max-width: 100px; max-height: 100px; }
            .content .media-link { font-size: 12px; margin-top: 4px; max-width: 100%; overflow-wrap: break-word; }
            .content .media-link a { color: #1976d2; text-decoration: none; word-break: break-all; display: inline-block; max-width: 100%; }
            .content .media-link a:hover { text-decoration: underline; }
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

  private isSameDay(date1: string, date2: string): boolean {
    if (!date1 || !date2) {
      return false;
    }

    const d1 = new Date(date1);
    const d2 = new Date(date2);

    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return false;
    }

    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  }

  private formatDateSeparator(dateString: string): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return '';
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    if (messageDate.getTime() === today.getTime()) {
      return 'Hoje';
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (messageDate.getTime() === yesterday.getTime()) {
      return 'Ontem';
    }

    const diffMs = today.getTime() - messageDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 7 && diffDays > 0) {
      const weekdays = [
        'Domingo',
        'Segunda-feira',
        'Terça-feira',
        'Quarta-feira',
        'Quinta-feira',
        'Sexta-feira',
        'Sábado',
      ];
      return weekdays[date.getDay()];
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private getAuthorName(
    msg: ListMessageResult,
    isUser: boolean,
    clientName: string
  ): string {
    if (isUser) {
      return this.getFirstName(clientName);
    }

    const operatorName = msg.user?.name || 'Operador';
    return this.getFirstName(operatorName);
  }

  private getFirstName(fullName: string): string {
    if (!fullName || !fullName.trim()) {
      return 'Usuário';
    }

    const trimmed = fullName.trim();
    const firstSpaceIndex = trimmed.indexOf(' ');

    if (firstSpaceIndex === -1) {
      return trimmed;
    }

    return trimmed.substring(0, firstSpaceIndex);
  }

  private getPhoto(
    msg: ListMessageResult,
    isUser: boolean,
    clientPhoto: string | null
  ): string {
    if (isUser) {
      return clientPhoto || this.getDefaultAvatar();
    }

    return msg.user?.photo || this.getDefaultAvatar();
  }

  private getDefaultAvatar(): string {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" id="person-accent-4" aria-hidden="true" viewBox="0 0 128 128" data-token-id="356" class="_84d28683 _6b299406 _563f6418 c08bd467 _059e3e51" role="img" fetchPriority="low" aria-label="" preserveAspectRatio="xMidYMid slice"><g display="var(--svgDisplayLight)"><path fill="#e7e2dc" d="M0 0h128v128H0z"></path><path fill="#788fa5" d="M88.41 84.67a32 32 0 1 0-48.82 0 66.13 66.13 0 0 1 48.82 0"></path><path fill="#9db3c8" d="M88.41 84.67a32 32 0 0 1-48.82 0A66.79 66.79 0 0 0 0 128h128a66.79 66.79 0 0 0-39.59-43.33"></path><path fill="#56687a" d="M64 96a31.93 31.93 0 0 0 24.41-11.33 66.13 66.13 0 0 0-48.82 0A31.93 31.93 0 0 0 64 96"></path></g><g display="var(--svgDisplayDark)"><path fill="#38434f" d="M0 0h128v128H0z"></path><path fill="#788fa5" d="M88.41 84.67a32 32 0 1 0-48.82 0 66.13 66.13 0 0 1 48.82 0"></path><path fill="#9db3c8" d="M88.41 84.67a32 32 0 0 1-48.82 0A66.79 66.79 0 0 0 0 128h128a66.79 66.79 0 0 0-39.59-43.33"></path><path fill="#56687a" d="M64 96a31.93 31.93 0 0 0 24.41-11.33 66.13 66.13 0 0 0-48.82 0A31.93 31.93 0 0 0 64 96"></path></g></svg>`;
    const base64 = Buffer.from(svgContent).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
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

  private formatMessageContent(content: any, msg: ListMessageResult): string {
    if (!content) {
      return '';
    }

    if (content.type === 'text' && content.message) {
      return content.message.replace(/\n/g, '<br>');
    }

    if (content.type === 'image') {
      const imageUrl = content.image?.url || '';
      const caption = content.image?.caption || '';
      const parts: string[] = [];

      if (imageUrl) {
        const escapedUrl = this.escapeHtml(imageUrl);
        parts.push(`<img src="${escapedUrl}" alt="Imagem" />`);
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      if (caption) {
        parts.push(`<div>${caption.replace(/\n/g, '<br>')}</div>`);
      }

      return parts.length > 0 ? parts.join('') : '[Imagem]';
    }

    if (content.type === 'sticker') {
      const stickerUrl = content.sticker?.url || '';
      const parts: string[] = [];

      if (stickerUrl) {
        const escapedUrl = this.escapeHtml(stickerUrl);
        parts.push(
          `<img src="${escapedUrl}" alt="Sticker" class="sticker-img" />`
        );
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      return parts.length > 0 ? parts.join('') : '[Sticker]';
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

    if (content.type === 'location') {
      return `[Localização] ${content.name || ''}`;
    }

    if (content.type === 'contact_card') {
      return `[Contato] ${content.contact?.name || ''}`;
    }

    return '[Mensagem não suportada]';
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
