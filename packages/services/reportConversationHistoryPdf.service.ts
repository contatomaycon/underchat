import { injectable } from 'tsyringe';
import { StorageService } from './storage.service';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Environment } from '@core/config/environments';
import puppeteer from 'puppeteer';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ReportConversationHistoryPdfUpdaterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfUpdater.repository';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ElasticDatabaseService } from './elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { IChat } from '@core/common/interfaces/IChat';
import { ReportConversationHistoryMessagesListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryMessagesLister.useCase';
import { ChatContactService } from './chatContact.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';

@injectable()
export class ReportConversationHistoryPdfService {
  private contactPhoneCache: Map<string, string | null> = new Map();

  constructor(
    private readonly storageService: StorageService,
    private readonly pdfUpdaterRepository: ReportConversationHistoryPdfUpdaterRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly messagesListerUseCase: ReportConversationHistoryMessagesListerUseCase,
    private readonly chatContactService: ChatContactService
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

    const uniqueContactIds = new Set<string>();
    for (const msg of messagesResult.messages) {
      const contactId = msg.content?.contact?.contact_id;
      if (contactId && typeof contactId === 'string') {
        uniqueContactIds.add(contactId);
      }
    }

    const phonePromises = Array.from(uniqueContactIds).map(
      async (contactId) => {
        try {
          const phone =
            await this.chatContactService.getChatContactPhoneDecrypted(
              contactId
            );
          return { contactId, phone };
        } catch {
          return { contactId, phone: null };
        }
      }
    );

    const phoneResults = await Promise.all(phonePromises);
    for (const { contactId, phone } of phoneResults) {
      this.contactPhoneCache.set(contactId, phone);
    }

    const html = this.generateHtmlFromMessages(
      messagesResult.messages,
      clientName,
      clientPhoto,
      chat
    );

    this.contactPhoneCache.clear();

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
    clientPhoto: string | null,
    chat: IChat | null
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

      const contentType = msg.content?.type || '';
      const isMediaType = ['audio', 'video', 'document'].includes(contentType);
      const mediaClass = isMediaType ? 'bubble-media' : '';
      const reactionsHtml = this.formatReactions(
        msg,
        contentType,
        alignmentClass
      );
      const hasReactions =
        msg.content?.reactions &&
        msg.content.reactions.length > 0 &&
        contentType !== EMessageType.annotation;
      const reactionsClass = hasReactions ? 'has-reactions' : '';

      parts.push(`
        <div class="msg-row ${alignmentClass}">
          <div class="msg-avatar">
            <img src="${photo}" alt="${author}" class="avatar-img" />
            <div class="msg-name">${author}</div>
          </div>
          <div class="bubble ${alignmentClass} ${mediaClass} ${reactionsClass}">
            <div class="content">${content}</div>
            <div class="meta">
              <span class="time">${timeOnly}</span>
            </div>
            ${reactionsHtml}
          </div>
        </div>
      `);
    }

    const messagesHtml = parts.join('');
    const headerHtml = this.generateHeaderHtml(chat, messages);

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; background: #f4f5f7; }
            .header { background: #ffffff; padding: 20px; border-radius: 8px; margin-bottom: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .header-row { display: flex; margin-bottom: 12px; }
            .header-row:last-child { margin-bottom: 0; }
            .header-label { font-weight: 600; color: #111b21; width: 220px; font-size: 14px; }
            .header-value { color: rgba(17,27,33,0.8); font-size: 14px; flex: 1; }
            .header-divider { border-top: 1px solid rgba(17, 27, 33, 0.12); margin: 16px 0; width: 100%; }
            .chat-log { display: flex; flex-direction: column; gap: 16px; }
            .date-separator-wrapper { display: flex; justify-content: center; align-items: center; width: 100%; gap: 8px; margin: 16px 0; }
            .date-separator-line { flex: 0.25; height: 1px; background-color: rgba(17, 27, 33, 0.12); }
            .date-separator { font-size: 0.75rem; font-weight: 500; background-color: rgba(17, 27, 33, 0.12); color: rgba(17, 27, 33, 0.65); padding: 4px 12px; border-radius: 7.5px; display: inline-block; min-width: fit-content; white-space: nowrap; }
            .msg-row { display: flex; width: 100%; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
            .msg-row.left { justify-content: flex-start; }
            .msg-row.right { justify-content: flex-end; }
            .msg-avatar { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 50px; }
            .msg-row.left .msg-avatar { order: 1; }
            .msg-row.right .msg-avatar { order: 3; }
            .avatar-img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #e0e0e0; }
            .msg-name { font-size: 11px; color: rgba(17,27,33,0.6); white-space: nowrap; font-weight: 500; text-align: center; }
            .bubble { max-width: 65%; width: fit-content; padding: 8px 12px 20px 12px; border-radius: 8px; position: relative; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .bubble.has-reactions { padding-bottom: 28px; padding-right: 60px; }
            .bubble.bubble-media { max-width: 280px; }
            .msg-row.left .bubble { order: 2; background: rgb(255, 255, 255); color: #111b21; }
            .msg-row.right .bubble { order: 2; background: rgb(217, 253, 211); color: #111b21; }
            .content { font-size: 14.2px; word-break: break-word; margin-bottom: 4px; }
            .content img { max-width: 200px; max-height: 200px; width: auto; height: auto; border-radius: 8px; margin-bottom: 8px; object-fit: contain; }
            .content img.sticker-img { max-width: 100px; max-height: 100px; }
            .content .media-link { font-size: 12px; margin-top: 4px; max-width: 100%; overflow-wrap: break-word; }
            .content .media-link a { color: #1976d2; text-decoration: none; word-break: break-all; display: inline-block; max-width: 100%; }
            .content .media-link a:hover { text-decoration: underline; }
            .content .audio-player { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(0,0,0,0.05); border-radius: 6px; margin-bottom: 8px; width: 100%; box-sizing: border-box; }
            .content .audio-player-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 50%; flex-shrink: 0; }
            .content .audio-player-icon svg { width: 16px; height: 16px; fill: #111b21; }
            .content .audio-player-info { flex: 1; min-width: 0; }
            .content .audio-player-duration { font-size: 13px; color: #111b21; font-weight: 500; }
            .content .video-player { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; background: rgba(0,0,0,0.05); border-radius: 6px; margin-bottom: 8px; width: 100%; box-sizing: border-box; }
            .content .video-player-header { display: flex; align-items: center; gap: 10px; }
            .content .video-player-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 50%; flex-shrink: 0; }
            .content .video-player-icon svg { width: 16px; height: 16px; fill: #111b21; }
            .content .video-player-info { flex: 1; min-width: 0; }
            .content .video-player-meta { font-size: 12px; color: rgba(17,27,33,0.6); }
            .content .document-player { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(0,0,0,0.05); border-radius: 6px; margin-bottom: 8px; width: 100%; box-sizing: border-box; }
            .content .document-player-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.1); border-radius: 6px; flex-shrink: 0; }
            .content .document-player-icon svg { width: 18px; height: 18px; fill: #1976d2; }
            .content .document-player-info { flex: 1; min-width: 0; }
            .content .document-player-name { font-size: 13px; color: #111b21; font-weight: 500; margin-bottom: 2px; word-break: break-word; }
            .content .document-player-meta { font-size: 12px; color: rgba(17,27,33,0.6); }
            .meta { position: absolute; right: 8px; bottom: 4px; display: flex; gap: 4px; align-items: center; font-size: 11px; color: rgba(17,27,33,0.6); }
            .time { font-weight: 500; }
            .reactions-summary { position: absolute; display: inline-flex; gap: 4px; bottom: 0; transform: translateY(50%); z-index: 11; }
            .reactions-summary--left { justify-content: flex-start; left: 16px; }
            .reactions-summary--right { justify-content: flex-end; right: 16px; }
            .reactions-summary--center { justify-content: center; left: 50%; transform: translateX(-50%) translateY(60%); }
            .reaction-summary-bubble { display: inline-flex; align-items: center; background: rgb(255, 255, 255); border-radius: 999px; padding: 2px 8px; min-height: 22px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); border: 0.5px solid rgba(17, 27, 33, 0.08); gap: 8px; }
            .reaction-summary-item { display: inline-flex; align-items: center; gap: 4px; }
            .reaction-summary-emoji { font-size: 0.9rem; line-height: 1; }
            .reaction-summary-count { font-size: 0.7rem; font-weight: 600; color: rgba(17, 27, 33, 0.7); }
          </style>
        </head>
        <body>
          ${headerHtml}
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
      const parts: string[] = [];
      const messageText = content.message.replace(/\n/g, '<br>');

      if (content.link_preview?.title) {
        parts.push(messageText);
        parts.push(this.formatLinkPreview(content.link_preview, msg));
        return parts.join('');
      }

      return messageText;
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
      const videoUrl = content.video?.url || '';
      const caption = content.video?.caption || '';
      const parts: string[] = [];

      if (videoUrl) {
        const escapedUrl = this.escapeHtml(videoUrl);
        const extension = content.video?.extension?.toUpperCase() || 'VIDEO';
        const size = content.video?.size
          ? this.formatDocumentSize(content.video.size)
          : null;
        const duration = content.video?.duration
          ? this.formatVideoDuration(content.video.duration)
          : null;
        const metaParts = [extension, size, duration].filter(Boolean);
        const meta = metaParts.join(' • ');

        parts.push(`
          <div class="video-player">
            <div class="video-player-header">
              <div class="video-player-icon">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
              <div class="video-player-info">
                <div class="video-player-meta">${this.escapeHtml(meta)}</div>
              </div>
            </div>
          </div>
        `);
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      if (caption) {
        parts.push(`<div>${caption.replace(/\n/g, '<br>')}</div>`);
      }

      return parts.length > 0 ? parts.join('') : '[Vídeo]';
    }

    if (content.type === 'audio') {
      const audioUrl = content.audio?.url || '';
      const parts: string[] = [];

      if (audioUrl) {
        const escapedUrl = this.escapeHtml(audioUrl);
        const duration = content.audio?.duration
          ? this.formatAudioTime(content.audio.duration)
          : '0:00';

        parts.push(`
          <div class="audio-player">
            <div class="audio-player-icon">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <div class="audio-player-info">
              <div class="audio-player-duration">${this.escapeHtml(duration)}</div>
            </div>
          </div>
        `);
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      return parts.length > 0 ? parts.join('') : '[Áudio]';
    }

    if (content.type === 'document') {
      const documentUrl = content.document?.url || '';
      const parts: string[] = [];

      if (documentUrl) {
        const escapedUrl = this.escapeHtml(documentUrl);
        const name = content.document?.name || 'Documento';
        const extension = content.document?.extension?.toUpperCase() || 'FILE';
        const size = content.document?.size
          ? this.formatDocumentSize(content.document.size)
          : null;
        const meta = size ? `${extension} • ${size}` : extension;

        parts.push(`
          <div class="document-player">
            <div class="document-player-icon">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
              </svg>
            </div>
            <div class="document-player-info">
              <div class="document-player-name">${this.escapeHtml(name)}</div>
              <div class="document-player-meta">${this.escapeHtml(meta)}</div>
            </div>
          </div>
        `);
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      return parts.length > 0 ? parts.join('') : '[Documento]';
    }

    if (content.type === 'location') {
      const location = content.location;
      const parts: string[] = ['[Localização]'];

      if (location?.name || location?.address) {
        const locationText = location.name || location.address || '';
        parts.push(`<div>${this.escapeHtml(locationText)}</div>`);
      }

      if (location?.latitude && location?.longitude) {
        const googleMapsUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
        const escapedUrl = this.escapeHtml(googleMapsUrl);
        parts.push(
          `<div class="media-link"><b>Link:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
        );
      }

      return parts.join('');
    }

    if (content.type === 'contact_card') {
      const contact = content.contact;
      if (!contact) {
        return '[Contato]';
      }

      return this.formatContactCard(contact, msg, content.message);
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

  private formatDocumentSize(bytes?: number | null): string {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  private formatVideoDuration(duration?: number | null): string {
    if (!duration || duration <= 0) return '';
    const totalSeconds = Math.floor(duration);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private formatAudioTime(seconds?: number | null): string {
    if (!seconds || seconds <= 0) return '0:00';
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  private formatPhone(phone: string, ddi?: string | null): string {
    const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;
    const extracted = extractPhoneAndDdi(phoneWithPlus);

    let phoneNumbers = phone.replaceAll(/\D/g, '');
    let phoneDdi = ddi;

    if (extracted) {
      phoneDdi = extracted.phone_ddi;
      phoneNumbers = extracted.phone;
    } else if (phoneDdi && phoneNumbers.startsWith(phoneDdi)) {
      phoneNumbers = phoneNumbers.slice(phoneDdi.length);
    } else if (!phoneDdi && phoneNumbers.length > 11) {
      phoneDdi = phoneNumbers.slice(0, 2);
      phoneNumbers = phoneNumbers.slice(2);
    }

    const numbers = phoneNumbers.slice(0, 11);
    let formatted = '';

    if (numbers.length <= 2) {
      formatted = numbers;
    } else if (numbers.length <= 6) {
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    } else if (numbers.length <= 10) {
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
    } else {
      formatted = `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    }

    if (phoneDdi) {
      return `+${phoneDdi} ${formatted}`;
    }

    return formatted;
  }

  private formatLinkPreview(linkPreview: any, msg: ListMessageResult): string {
    if (!linkPreview?.title) {
      return '';
    }

    const isUser = msg.type_user === ETypeUserChat.client;
    const previewImage = this.resolvePreviewImage(linkPreview);
    const previewUrl = this.resolvePreviewUrl(linkPreview);
    const domain = this.domainFromUrl(previewUrl);
    const title = linkPreview.title || '';
    const description = linkPreview.description || '';

    const backgroundColor = isUser
      ? 'rgb(243, 244, 246)'
      : 'rgb(214, 243, 207)';
    const textColor = isUser ? 'rgb(17, 27, 33)' : 'rgb(17, 27, 33)';

    const parts: string[] = [];

    parts.push(`
      <div class="link-preview" style="
        padding: 12px;
        margin-top: 8px;
        margin-bottom: 8px;
        max-width: 100%;
        background-color: ${backgroundColor};
        color: ${textColor};
        border-radius: 8px;
      ">
        <div class="lp-main" style="display: flex; gap: 12px;">
    `);

    if (previewImage) {
      parts.push(`
        <div class="lp-thumb" style="
          width: 80px;
          height: 80px;
          border-radius: 4px;
          overflow: hidden;
          flex-shrink: 0;
        ">
          <img src="${this.escapeHtml(previewImage)}" alt="" style="
            width: 100%;
            height: 100%;
            object-fit: cover;
          " />
        </div>
      `);
    }

    parts.push(`
      <div class="lp-text" style="flex: 1; min-width: 0;">
        ${
          domain
            ? `<div class="lp-domain" style="
          font-size: 12px;
          margin-bottom: 4px;
          color: rgba(17, 27, 33, 0.6);
        ">${this.escapeHtml(domain)}</div>`
            : ''
        }
        <div class="lp-title" style="
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 4px;
          line-height: 1.3;
        ">${this.escapeHtml(title)}</div>
        ${
          description
            ? `<div class="lp-desc" style="
          font-size: 12px;
          color: rgba(17, 27, 33, 0.7);
          line-height: 1.4;
        ">${this.escapeHtml(description)}</div>`
            : ''
        }
      </div>
    </div>
    `);

    if (previewUrl) {
      parts.push(`
        <a href="${this.escapeHtml(previewUrl)}" target="_blank" rel="noopener noreferrer" class="lp-url" style="
          display: block;
          margin-top: 8px;
          font-size: 14px;
          color: rgba(25, 118, 210, 0.9);
          text-decoration: none;
          word-break: break-all;
        ">${this.escapeHtml(previewUrl)}</a>
      `);
    }

    parts.push('</div>');

    return parts.join('');
  }

  private resolvePreviewImage(linkPreview?: any): string {
    if (!linkPreview) {
      return '';
    }

    if (linkPreview.originalThumbnailUrl) {
      return linkPreview.originalThumbnailUrl;
    }

    if (linkPreview.highQualityThumbnail) {
      return linkPreview.highQualityThumbnail;
    }

    if (linkPreview.jpegThumbnail) {
      if (typeof linkPreview.jpegThumbnail === 'string') {
        if (linkPreview.jpegThumbnail.startsWith('data:')) {
          return linkPreview.jpegThumbnail;
        }
        return `data:image/jpeg;base64,${linkPreview.jpegThumbnail}`;
      }
    }

    return '';
  }

  private resolvePreviewUrl(linkPreview?: any): string {
    if (!linkPreview) {
      return '';
    }

    return linkPreview['canonical-url'] || linkPreview['matched-text'] || '';
  }

  private domainFromUrl(url: string): string {
    if (!url) {
      return '';
    }

    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  private getReactionsSummary(
    reactions?: Array<{ emoji?: string | null }> | null
  ): Array<{ emoji: string; count: number }> {
    if (!reactions?.length) {
      return [];
    }

    const summary = new Map<string, { emoji: string; count: number }>();

    for (const reaction of reactions) {
      if (!reaction?.emoji) {
        continue;
      }

      const current = summary.get(reaction.emoji);
      if (!current) {
        summary.set(reaction.emoji, { emoji: reaction.emoji, count: 1 });
        continue;
      }

      current.count += 1;
    }

    return Array.from(summary.values()).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.emoji.localeCompare(b.emoji);
    });
  }

  private formatReactions(
    msg: ListMessageResult,
    contentType: string,
    alignmentClass: string
  ): string {
    if (
      !msg.content?.reactions ||
      msg.content.reactions.length === 0 ||
      contentType === EMessageType.annotation
    ) {
      return '';
    }

    const reactionsSummary = this.getReactionsSummary(msg.content.reactions);
    if (reactionsSummary.length === 0) {
      return '';
    }

    let positionClass = 'reactions-summary--left';
    if (contentType === EMessageType.system) {
      positionClass = 'reactions-summary--center';
    } else if (alignmentClass === 'right') {
      positionClass = 'reactions-summary--right';
    }

    const reactionItems = reactionsSummary
      .map(
        (reaction) => `
        <div class="reaction-summary-item">
          <span class="reaction-summary-emoji">${this.escapeHtml(
            reaction.emoji
          )}</span>
          <span class="reaction-summary-count">${reaction.count}</span>
        </div>
      `
      )
      .join('');

    return `
      <div class="reactions-summary ${positionClass}">
        <div class="reaction-summary-bubble">
          ${reactionItems}
        </div>
      </div>
    `;
  }

  private formatContactCard(
    contact: any,
    msg: ListMessageResult,
    message?: string | null
  ): string {
    const isUser = msg.type_user === ETypeUserChat.client;
    const hasPhoto = !!contact.photo;
    const contactPhoto = hasPhoto ? contact.photo : this.getDefaultAvatar();
    const contactName = contact.name || '';
    const contactLastName = contact.last_name || '';
    const fullName = contactLastName
      ? `${contactName} ${contactLastName}`
      : contactName;

    let phoneDisplay = '';
    if (contact.contact_id) {
      const phone = this.contactPhoneCache.get(contact.contact_id);
      if (phone) {
        const phoneDdi = contact.phone_ddi || null;
        phoneDisplay = this.formatPhone(phone, phoneDdi);
      }
    }

    if (!phoneDisplay && contact.phone_partial) {
      phoneDisplay = contact.phone_partial;
    }

    const backgroundColor = isUser
      ? 'rgba(255, 255, 255, 0.5)'
      : 'rgba(255, 255, 255, 0.3)';
    const textColor = isUser ? 'rgb(17, 27, 33)' : 'rgb(17, 27, 33)';

    const parts: string[] = [];

    parts.push(`
      <div class="contact-bubble" style="
        max-width: 100%;
        position: relative;
        padding-bottom: 0;
        margin-bottom: 0;
      ">
        <div class="contact-item" style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background-color: ${backgroundColor};
          border-radius: 8px;
        ">
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            overflow: visible;
            flex-shrink: 0;
            background-color: ${hasPhoto ? 'transparent' : 'rgba(25, 118, 210, 0.12)'};
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
          ">
            <img src="${this.escapeHtml(contactPhoto)}" alt="${this.escapeHtml(fullName)}" style="
              width: 40px;
              height: 40px;
              border-radius: 50%;
              object-fit: contain;
              object-position: center;
              background-color: ${hasPhoto ? 'transparent' : 'rgba(25, 118, 210, 0.12)'};
            " />
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="
              font-size: 14px;
              font-weight: 500;
              color: ${textColor};
              margin-bottom: ${phoneDisplay ? '2px' : '0'};
            ">${this.escapeHtml(fullName)}</div>
            ${
              phoneDisplay
                ? `<div style="
                  font-size: 12px;
                  color: rgba(17, 27, 33, 0.6);
                ">${this.escapeHtml(phoneDisplay)}</div>`
                : ''
            }
          </div>
        </div>
        ${
          message
            ? `<p style="
              margin-top: 8px;
              margin-bottom: 0;
              white-space: pre-wrap;
              word-break: break-word;
              color: ${textColor};
              font-size: 14px;
              line-height: 1.5;
            ">${this.escapeHtml(message.replace(/\n/g, '<br>'))}</p>`
            : ''
        }
      </div>
    `);

    return parts.join('');
  }

  private generateHeaderHtml(
    chat: IChat | null,
    messages: ListMessageResult[]
  ): string {
    if (!chat) {
      return '';
    }

    const name = chat.name || chat.contact?.name || '-';
    const phone = chat.phone || '';
    const phoneDdi = chat.contact?.phone_ddi || null;
    const formattedPhone = phone ? this.formatPhone(phone, phoneDdi) : '-';
    const sector = chat.sector?.name || '-';

    const firstMessage = messages.length > 0 ? messages[0] : null;
    const lastMessage =
      messages.length > 0 ? messages[messages.length - 1] : null;

    const firstMessageDate = firstMessage?.date || null;
    const lastMessageDate = lastMessage?.date || null;

    const attendanceDate = firstMessageDate
      ? this.formatFullDateTime(firstMessageDate)
      : '-';
    const closingDate = lastMessageDate
      ? this.formatFullDateTime(lastMessageDate)
      : '-';

    const protocolStart =
      chat.protocol_start && chat.protocol_start.length > 0
        ? chat.protocol_start.join(', ')
        : '-';

    const protocolTransfer =
      chat.protocol_transfer && chat.protocol_transfer.length > 0
        ? chat.protocol_transfer.join(', ')
        : '-';

    const protocolUra =
      chat.protocol_ura && chat.protocol_ura.length > 0
        ? chat.protocol_ura.join(', ')
        : '-';

    const attendanceTime = this.calculateAttendanceTime(
      firstMessageDate,
      lastMessageDate
    );

    const averageResponseTime = this.calculateAverageResponseTime(messages);

    return `
      <div class="header">
        <div class="header-row">
          <div class="header-label">Nome:</div>
          <div class="header-value">${this.escapeHtml(name)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Telefone:</div>
          <div class="header-value">${this.escapeHtml(formattedPhone)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Data de Atendimento:</div>
          <div class="header-value">${this.escapeHtml(attendanceDate)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Data de Encerramento:</div>
          <div class="header-value">${this.escapeHtml(closingDate)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Setor:</div>
          <div class="header-value">${this.escapeHtml(sector)}</div>
        </div>
        <div class="header-divider"></div>
        <div class="header-row">
          <div class="header-label">Protocolo de Atendimento:</div>
          <div class="header-value">${this.escapeHtml(protocolStart)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Protocolo de Transferência:</div>
          <div class="header-value">${this.escapeHtml(protocolTransfer)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Protocolo URA:</div>
          <div class="header-value">${this.escapeHtml(protocolUra)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Tempo de Atendimento:</div>
          <div class="header-value">${this.escapeHtml(attendanceTime)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">Tempo Médio de Resposta:</div>
          <div class="header-value">${this.escapeHtml(averageResponseTime)}</div>
        </div>
      </div>
    `;
  }

  private formatFullDateTime(dateString: string): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return '';
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  }

  private calculateAttendanceTime(
    startDate: string | null,
    endDate: string | null
  ): string {
    if (!startDate || !endDate) {
      return '-';
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return '-';
    }

    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) {
      return '-';
    }

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      const hours = diffHours % 24;
      const minutes = diffMinutes % 60;
      if (hours > 0) {
        return `${diffDays}d ${hours}h ${minutes}min`;
      }
      return `${diffDays}d ${minutes}min`;
    }

    if (diffHours > 0) {
      const minutes = diffMinutes % 60;
      if (minutes > 0) {
        return `${diffHours}h ${minutes}min`;
      }
      return `${diffHours}h`;
    }

    if (diffMinutes > 0) {
      const seconds = diffSeconds % 60;
      if (seconds > 0) {
        return `${diffMinutes}min ${seconds}s`;
      }
      return `${diffMinutes}min`;
    }

    return `${diffSeconds}s`;
  }

  private calculateAverageResponseTime(messages: ListMessageResult[]): string {
    if (messages.length < 2) {
      return '-';
    }

    const responseTimes: number[] = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const currentMsg = messages[i];
      const nextMsg = messages[i + 1];

      if (
        currentMsg.type_user === ETypeUserChat.client &&
        nextMsg.type_user === ETypeUserChat.operator
      ) {
        const currentDate = new Date(currentMsg.date || '');
        const nextDate = new Date(nextMsg.date || '');

        if (!isNaN(currentDate.getTime()) && !isNaN(nextDate.getTime())) {
          const diffMs = nextDate.getTime() - currentDate.getTime();
          if (diffMs >= 0) {
            responseTimes.push(diffMs);
          }
        }
      }
    }

    if (responseTimes.length === 0) {
      return '-';
    }

    const totalMs = responseTimes.reduce((sum, time) => sum + time, 0);
    const averageMs = totalMs / responseTimes.length;

    const averageSeconds = Math.floor(averageMs / 1000);
    const averageMinutes = Math.floor(averageSeconds / 60);
    const averageHours = Math.floor(averageMinutes / 60);
    const averageDays = Math.floor(averageHours / 24);

    if (averageDays > 0) {
      const hours = averageHours % 24;
      const minutes = averageMinutes % 60;
      if (hours > 0) {
        return `${averageDays}d ${hours}h ${minutes}min`;
      }
      return `${averageDays}d ${minutes}min`;
    }

    if (averageHours > 0) {
      const minutes = averageMinutes % 60;
      if (minutes > 0) {
        return `${averageHours}h ${minutes}min`;
      }
      return `${averageHours}h`;
    }

    if (averageMinutes > 0) {
      const seconds = averageSeconds % 60;
      if (seconds > 0) {
        return `${averageMinutes}min ${seconds}s`;
      }
      return `${averageMinutes}min`;
    }

    return `${averageSeconds}s`;
  }
}
