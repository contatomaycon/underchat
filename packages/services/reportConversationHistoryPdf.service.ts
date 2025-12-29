import { injectable } from 'tsyringe';
import { StorageService } from './storage.service';
import puppeteer, { Page, ElementHandle } from 'puppeteer';
import {
  ListMessageResult,
  LocationMessageChat,
  LinkPreview,
  ContentMessageChat,
} from '@core/schema/chat/listMessageChats/response.schema';
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
import { TFunction } from 'i18next';
import {
  IQuotedMessage,
  IContactMessage,
  QuotedMessageType,
} from '@core/common/interfaces/IChatMessage';
import { WAUrlInfo } from '@whiskeysockets/baileys';

@injectable()
export class ReportConversationHistoryPdfService {
  private readonly contactPhoneCache: Map<string, string | null> = new Map();

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

  async generatePdf(
    accountId: string,
    chatId: string,
    t: TFunction<'translation', undefined>
  ): Promise<string> {
    const [chat, messagesResult] = await Promise.all([
      this.getChat(accountId, chatId),
      this.messagesListerUseCase.execute(accountId, chatId),
    ]);

    const clientName = chat?.name ?? chat?.contact?.name ?? t('client');
    const clientPhoto = chat?.photo ?? chat?.contact?.photo ?? null;

    await this.loadContactPhones(messagesResult.messages);

    const html = this.generateHtmlFromMessages(
      messagesResult.messages,
      clientName,
      clientPhoto,
      chat,
      t
    );

    this.contactPhoneCache.clear();

    const executablePath = await this.findChromiumExecutable();
    const pdfBuffer = await this.generatePdfFromHtml(html, executablePath);
    const key = `report-conversation-history/${chatId}/history.pdf`;

    return await this.storageService.uploadPdf(pdfBuffer, accountId, key);
  }

  private async loadContactPhones(
    messages: ListMessageResult[]
  ): Promise<void> {
    const uniqueContactIds = new Set<string>();
    for (const msg of messages) {
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
  }

  private async findChromiumExecutable(): Promise<string | undefined> {
    const fs = await import('fs');
    const chromiumPaths = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];

    for (const path of chromiumPaths) {
      try {
        if (fs.existsSync(path)) {
          const stat = fs.statSync(path);
          if (
            stat.isFile() ||
            (stat.isSymbolicLink() && path.includes('snap'))
          ) {
            return path;
          }
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async generatePdfFromHtml(
    html: string,
    executablePath: string | undefined
  ): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      ...(executablePath && { executablePath }),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.setViewport({ width: 1200, height: 800 });

      await this.waitForMapsToLoad(page);

      const mapContainers = await page.$$('[id^="map-"]');
      for (const container of mapContainers) {
        await this.processMapContainer(page, container);
      }

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
      return Buffer.from(pdfBuffer);
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private async waitForMapsToLoad(page: Page): Promise<void> {
    await page.evaluate(() => {
      return new Promise<void>((resolve: () => void) => {
        const doc = (globalThis as any).document;
        if (!doc) {
          resolve();
          return;
        }

        const mapContainers = doc.querySelectorAll('[id^="map-"]');
        if (mapContainers.length === 0) {
          resolve();
          return;
        }

        let loadedCount = 0;
        const totalMaps = mapContainers.length;
        let allMapsResolved = false;

        const isMapContainerLoaded = (container: any): boolean => {
          const canvas = container.querySelector(
            '[class*="maplibregl-canvas"]'
          );
          const isLoaded = container.dataset.mapLoaded === 'true';

          const hasValidCanvas =
            canvas &&
            canvas.width > 0 &&
            canvas.height > 0 &&
            canvas.getContext;

          return hasValidCanvas || isLoaded;
        };

        const checkMapLoaded = (container: any): boolean => {
          if (allMapsResolved) return false;
          return isMapContainerLoaded(container);
        };

        const handleAllMapsLoaded = (): void => {
          setTimeout(resolve, 3000);
        };

        const handleMapCheck = (checkInterval: NodeJS.Timeout): void => {
          if (allMapsResolved) {
            clearInterval(checkInterval);
            return;
          }

          for (const container of mapContainers) {
            if (checkMapLoaded(container)) {
              loadedCount++;
            }
          }

          if (loadedCount === totalMaps && !allMapsResolved) {
            allMapsResolved = true;
            clearInterval(checkInterval);
            handleAllMapsLoaded();
          }
        };

        const handleTimeout = (checkInterval: NodeJS.Timeout): void => {
          clearInterval(checkInterval);
          if (!allMapsResolved) {
            allMapsResolved = true;
            resolve();
          }
        };

        const checkInterval = setInterval(
          () => handleMapCheck(checkInterval),
          500
        );

        setTimeout(() => handleTimeout(checkInterval), 25000);
      });
    });
  }

  private async processMapContainer(
    page: Page,
    container: ElementHandle
  ): Promise<void> {
    try {
      const screenshot = await container.screenshot({
        type: 'png',
        encoding: 'base64',
      });

      if (!screenshot) {
        return;
      }

      const mapId = await container.evaluate((el: any) =>
        el.getAttribute('id')
      );

      if (!mapId) {
        return;
      }

      await page.evaluate(
        (id: string, imgData: string) => {
          const doc = (globalThis as any).document;
          const container = doc.getElementById(id);
          if (container) {
            container.innerHTML = `<img src="data:image/png;base64,${imgData}" style="width: 100%; height: 100%; object-fit: cover;" />`;
          }
        },
        mapId,
        screenshot
      );
    } catch (e) {
      console.error(e);
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
    return (hit?._source as IChat) ?? null;
  }

  private calculateReactionStyles(reactionsCount: number): {
    paddingBottom: number;
    paddingRight: number;
    metaBottom: number;
  } {
    const basePaddingBottom = 20;
    const reactionHeight = 22;
    const reactionOffset = reactionHeight / 2;
    const metaBottomPosition = 4;
    const metaHeight = 16;
    const extraSpace = 4;

    const paddingBottom =
      reactionsCount > 0
        ? Math.max(
            basePaddingBottom + reactionHeight / 2,
            reactionOffset +
              metaBottomPosition +
              metaHeight +
              extraSpace +
              reactionsCount * 2
          )
        : basePaddingBottom;

    const paddingRight = reactionsCount > 0 ? 60 : 12;
    const metaBottom =
      reactionsCount > 0 ? Math.max(4, reactionHeight / 2 + 2) : 4;

    return { paddingBottom, paddingRight, metaBottom };
  }

  private getBubbleClasses(
    contentType: string,
    isSystem: boolean,
    hasReactions: boolean,
    isDeleted: boolean
  ): string {
    const isMediaType = ['audio', 'video', 'document'].includes(contentType);
    const mediaClass = isMediaType ? 'bubble-media' : '';
    const isAnnotation = contentType === EMessageType.annotation;
    const annotationClass = isAnnotation ? 'is-annotation' : '';
    const systemClass = isSystem ? 'is-system' : '';
    const reactionsClass = hasReactions ? 'has-reactions' : '';
    const deletedClass = isDeleted ? 'is-deleted' : '';

    return `${mediaClass} ${reactionsClass} ${deletedClass} ${annotationClass} ${systemClass}`.trim();
  }

  private getBubbleStyle(
    hasReactions: boolean,
    reactionsCount: number,
    contentType: string,
    isAnnotation: boolean
  ): string {
    const styles = this.calculateReactionStyles(reactionsCount);
    const bubbleStyleParts: string[] = [];

    if (hasReactions) {
      bubbleStyleParts.push(
        `padding-bottom: ${styles.paddingBottom}px; padding-right: ${styles.paddingRight}px;`
      );
    }

    let backgroundColor = '';
    if (isAnnotation) {
      backgroundColor = 'rgb(255, 243, 205)';
    } else if (contentType === EMessageType.system) {
      backgroundColor = 'rgb(227, 242, 253)';
    }

    if (backgroundColor) {
      bubbleStyleParts.push(`background: ${backgroundColor};`);
    }

    return bubbleStyleParts.length > 0 ? bubbleStyleParts.join(' ') : '';
  }

  private generateMessageHtml(params: {
    msg: ListMessageResult;
    author: string;
    photo: string;
    content: string;
    isSystem: boolean;
    alignmentClass: string;
    timeOnly: string;
    bubbleClasses: string;
    bubbleStyle: string;
    metaStyle: string;
    reactionsHtml: string;
    isDeleted: boolean;
    hasVersions: boolean;
    clientName: string;
    t: TFunction<'translation', undefined>;
  }): string {
    const {
      msg,
      author,
      photo,
      content,
      isSystem,
      alignmentClass,
      timeOnly,
      bubbleClasses,
      bubbleStyle,
      metaStyle,
      reactionsHtml,
      isDeleted,
      hasVersions,
      clientName,
      t,
    } = params;
    const avatarHtml = isSystem
      ? ''
      : `
          <div class="msg-avatar">
            <img src="${photo}" alt="${author}" class="avatar-img" />
            <div class="msg-name">${author}</div>
          </div>
          `;

    return `
        <div class="msg-row ${alignmentClass}">
          ${avatarHtml}
          <div class="bubble ${alignmentClass} ${bubbleClasses}" style="${bubbleStyle}">
            ${this.formatQuoted(msg, clientName, t)}
            <div class="content">
              <div class="message-text" style="word-break: break-word; overflow-wrap: break-word; hyphens: none;">${content}</div>
              ${isDeleted ? `<div class="message-deleted-badge">${t('removed')}</div>` : ''}
              ${hasVersions ? `<div class="message-edited-badge">${t('edited')}</div>` : ''}
            </div>
            <div class="meta" style="${metaStyle}">
              <div class="meta-content">
                <div class="meta-row">
                  <span class="time">${timeOnly}</span>
                </div>
              </div>
            </div>
            ${reactionsHtml}
          </div>
        </div>
      `;
  }

  private generateHtmlFromMessages(
    messages: ListMessageResult[],
    clientName: string,
    clientPhoto: string | null,
    chat: IChat | null,
    t: TFunction<'translation', undefined>
  ): string {
    const parts: string[] = [];
    let lastDate: string | null = null;

    for (const msg of messages) {
      const messageDate = msg.date ?? '';

      if (!lastDate || !this.isSameDay(messageDate, lastDate)) {
        const separatorLabel = this.formatDateSeparator(messageDate, t);
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
      const author = this.getAuthorName(msg, isUser, clientName, t);
      const photo = this.getPhoto(msg, isUser, clientPhoto);
      const content = msg.content
        ? this.formatMessageContent(msg.content, msg, t)
        : '';
      const contentType = msg.content?.type ?? '';
      const isSystem = contentType === EMessageType.system;
      let alignmentClass = 'right';
      if (isSystem) {
        alignmentClass = 'center';
      } else if (isUser) {
        alignmentClass = 'left';
      }
      const timeOnly = this.formatTimeOnly(msg.date ?? '');

      const reactionsHtml = this.formatReactions(
        msg,
        contentType,
        alignmentClass
      );
      const hasReactions = !!(
        msg.content?.reactions &&
        msg.content.reactions.length > 0 &&
        contentType !== EMessageType.annotation
      );
      const isDeleted = msg.deleted === true;
      const hasVersions = !!(
        msg.content?.version && msg.content.version.length > 0
      );

      const reactionsSummary =
        hasReactions && msg.content?.reactions
          ? this.getReactionsSummary(msg.content.reactions)
          : [];
      const reactionsCount = reactionsSummary.length;

      const bubbleClasses = this.getBubbleClasses(
        contentType,
        isSystem,
        hasReactions,
        isDeleted
      );

      const bubbleStyle = this.getBubbleStyle(
        hasReactions,
        reactionsCount,
        contentType,
        contentType === EMessageType.annotation
      );

      const reactionStyles = this.calculateReactionStyles(reactionsCount);
      const metaStyle = hasReactions
        ? `bottom: ${reactionStyles.metaBottom}px;`
        : '';

      const messageHtml = this.generateMessageHtml({
        msg,
        author,
        photo,
        content,
        isSystem,
        alignmentClass,
        timeOnly,
        bubbleClasses,
        bubbleStyle,
        metaStyle,
        reactionsHtml,
        isDeleted,
        hasVersions,
        clientName,
        t,
      });

      parts.push(messageHtml);
    }

    const messagesHtml = parts.join('');
    const headerHtml = this.generateHeaderHtml(chat, messages, t);

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
          <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet" />
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
            .msg-row.center { justify-content: center; }
            .msg-avatar { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 50px; }
            .msg-row.left .msg-avatar { order: 1; }
            .msg-row.right .msg-avatar { order: 3; }
            .avatar-img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #e0e0e0; }
            .msg-name { font-size: 11px; color: rgba(17,27,33,0.6); white-space: nowrap; font-weight: 500; text-align: center; }
            .bubble { max-width: 65%; min-width: 50px; width: fit-content; padding: 8px 12px 20px 12px; border-radius: 8px; position: relative; line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .bubble.has-reactions { padding-bottom: 28px; padding-right: 60px; }
            .bubble.bubble-media { max-width: 280px; }
            .bubble.is-deleted { opacity: 0.7; }
            .bubble.is-deleted .content .message-text { text-decoration: line-through; }
            .bubble.is-deleted .content .message-deleted-badge { text-decoration: none !important; }
            .bubble.is-deleted .content .message-edited-badge { text-decoration: none !important; }
            .bubble.is-deleted .quoted-text, .bubble.is-deleted .image-caption, .bubble.is-deleted .video-caption, .bubble.is-deleted .audio-caption, .bubble.is-deleted .contact-caption { text-decoration: line-through; }
            .bubble.is-system { border-radius: 6px; text-align: center; margin: 0 auto; }
            .bubble.is-system .content { text-align: center; }
            .bubble.is-system .content .message-text { text-align: center; }
            .bubble.is-system .meta { text-align: center; }
            .bubble.is-system .meta .meta-content { align-items: center; }
            .msg-row.left .bubble { order: 2; background: rgb(255, 255, 255); color: #111b21; }
            .msg-row.right .bubble { order: 2; background: rgb(217, 253, 211); color: #111b21; }
            .content { font-size: 14.2px; word-break: break-word; overflow-wrap: break-word; hyphens: none; margin-bottom: 4px; }
            .content:has(+ .meta .message-deleted-badge) { margin-bottom: 0; }
            .message-current-version { margin-bottom: 8px; }
            .message-version { font-size: 13px; color: rgba(17, 27, 33, 0.7); margin-bottom: 4px; }
            .content img { max-width: 200px; max-height: 200px; width: auto; height: auto; border-radius: 8px; margin-bottom: 8px; object-fit: contain; }
            .content img.sticker-img { max-width: 100px; max-height: 100px; }
            .content .media-link { font-size: 12px; margin-top: 4px; max-width: 100%; overflow-wrap: break-word; }
            .content .media-link a { color: #1976d2; text-decoration: none; word-break: break-word; overflow-wrap: anywhere; display: inline-block; max-width: 100%; }
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
            .meta { position: absolute; right: 8px; bottom: 4px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; font-size: 11px; color: rgba(17,27,33,0.6); }
            .meta-content { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
            .meta-row { display: flex; gap: 4px; align-items: center; }
            .time { font-weight: 500; }
            .message-deleted-badge { font-size: 10.4px; color: rgba(17, 27, 33, 0.5); font-style: italic; line-height: 1; margin-top: 6px; text-align: right; text-decoration: none; display: block; }
            .message-edited-badge { font-size: 10.4px; color: rgba(17, 27, 33, 0.5); font-style: italic; line-height: 1; margin-top: 6px; text-align: right; text-decoration: none; display: block; }
            .reactions-summary { position: absolute; display: inline-flex; gap: 4px; bottom: 0; transform: translateY(50%); z-index: 11; }
            .reactions-summary--left { justify-content: flex-start; left: 16px; }
            .reactions-summary--right { justify-content: flex-end; right: 16px; }
            .reactions-summary--center { justify-content: center; left: 50%; transform: translateX(-50%) translateY(60%); }
            .reaction-summary-bubble { display: inline-flex; align-items: center; background: rgb(255, 255, 255); border-radius: 999px; padding: 2px 8px; min-height: 22px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); border: 0.5px solid rgba(17, 27, 33, 0.08); gap: 8px; }
            .reaction-summary-item { display: inline-flex; align-items: center; gap: 4px; }
            .reaction-summary-emoji { font-size: 0.9rem; line-height: 1; }
            .reaction-summary-count { font-size: 0.7rem; font-weight: 600; color: rgba(17, 27, 33, 0.7); }
            .quoted-block { border-left: 3px solid rgba(25, 118, 210, 0.5); padding-left: 8px; margin-bottom: 8px; padding-top: 4px; padding-bottom: 4px; border-radius: 4px; background: rgba(17, 27, 33, 0.04); }
            .quoted-block.is-right { border-left: none; border-right: 3px solid rgba(25, 118, 210, 0.5); padding-left: 0; padding-right: 8px; }
            .quoted-name { font-size: 12px; font-weight: 600; color: rgba(25, 118, 210, 0.9); margin-bottom: 2px; }
            .quoted-content { font-size: 12.8px; color: rgba(17, 27, 33, 0.7); }
            .quoted-media { width: 44px; height: 44px; border-radius: 4px; overflow: hidden; margin-bottom: 4px; }
            .quoted-media img { width: 100%; height: 100%; object-fit: cover; }
            .quoted-location, .quoted-document, .quoted-audio, .quoted-contact, .quoted-sticker { display: flex; align-items: center; gap: 8px; }
            .quoted-document-info, .quoted-audio-info, .quoted-video-info, .quoted-image-info { display: flex; flex-direction: column; gap: 2px; }
            .quoted-document-name, .quoted-audio-name, .quoted-video-name, .quoted-image-name { font-size: 12.8px; font-weight: 600; color: rgb(25, 118, 210); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .quoted-document-meta, .quoted-audio-meta, .quoted-video-meta, .quoted-image-meta { font-size: 11.2px; color: rgba(17, 27, 33, 0.6); }
            .quoted-text { color: rgba(17, 27, 33, 0.7); }
            .quoted-video-thumb { width: 100%; height: 100%; object-fit: cover; }
            .quoted-video-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.3); }
            .quoted-video-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: rgba(17, 27, 33, 0.1); }
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

    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
      return false;
    }

    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  }

  private formatDateSeparator(
    dateString: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
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
      return t('today');
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (messageDate.getTime() === yesterday.getTime()) {
      return t('yesterday');
    }

    const diffMs = today.getTime() - messageDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 7 && diffDays > 0) {
      const weekdays = [
        t('sunday'),
        t('monday'),
        t('tuesday'),
        t('wednesday'),
        t('thursday'),
        t('friday'),
        t('saturday'),
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
    clientName: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (isUser) {
      return this.getFirstName(clientName, t);
    }

    const operatorName = msg.user?.name ?? t('operator');
    return this.getFirstName(operatorName, t);
  }

  private getFirstName(
    fullName: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (!fullName?.trim()) {
      return t('user');
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
      return clientPhoto ?? this.getDefaultAvatar();
    }

    return msg.user?.photo ?? this.getDefaultAvatar();
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
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private formatSystemMessage(content: ContentMessageChat): string {
    if (content.type === EMessageType.system && content.message) {
      return content.message.replaceAll('\n', '<br>');
    }
    return '';
  }

  private formatTextMessage(
    content: ContentMessageChat,
    msg: ListMessageResult,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'text' || !content.message) {
      return '';
    }

    const parts: string[] = [];

    if (content.version && content.version.length > 0) {
      const currentText = (content.message ?? '').replaceAll('\n', '<br>');
      parts.push(
        `<div class="message-current-version"><strong>${currentText}</strong></div>`
      );

      const sortedVersions = [...content.version].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      for (let i = 0; i < sortedVersions.length; i++) {
        const version = sortedVersions[i];
        const versionText = (version.message ?? '').replaceAll('\n', '<br>');
        const versionNumber = i + 1;
        parts.push(
          `<div class="message-version">${t('version')} ${versionNumber}: ${versionText}</div>`
        );
      }
    } else {
      const messageText = content.message.replaceAll('\n', '<br>');
      parts.push(messageText);
    }

    if (content.link_preview?.title) {
      const linkPreview = content.link_preview as LinkPreview | WAUrlInfo;
      parts.push(this.formatLinkPreview(linkPreview, msg));
    }

    return parts.join('');
  }

  private formatImageMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'image') {
      return '';
    }

    const imageUrl = content.image?.url ?? '';
    const caption = content.image?.caption ?? '';
    const parts: string[] = [];

    if (imageUrl) {
      const escapedUrl = this.escapeHtml(imageUrl);
      parts.push(
        `<img src="${escapedUrl}" alt="${t('image')}" />`,
        `<div class="media-link"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    if (caption) {
      parts.push(`<div>${caption.replaceAll('\n', '<br>')}</div>`);
    }

    return parts.length > 0 ? parts.join('') : `[${t('image')}]`;
  }

  private formatStickerMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'sticker') {
      return '';
    }

    const stickerUrl = content.sticker?.url ?? '';
    const parts: string[] = [];

    if (stickerUrl) {
      const escapedUrl = this.escapeHtml(stickerUrl);
      parts.push(
        `<img src="${escapedUrl}" alt="${t('sticker')}" class="sticker-img" />`,
        `<div class="media-link"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    return parts.length > 0 ? parts.join('') : `[${t('sticker')}]`;
  }

  private formatVideoMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'video') {
      return '';
    }

    const videoUrl = content.video?.url ?? '';
    const caption = content.video?.caption ?? '';
    const parts: string[] = [];

    if (videoUrl) {
      const escapedUrl = this.escapeHtml(videoUrl);
      const extension = content.video?.extension?.toUpperCase() ?? 'VIDEO';
      const size = content.video?.size
        ? this.formatDocumentSize(content.video.size)
        : null;
      const duration = content.video?.duration
        ? this.formatVideoDuration(content.video.duration)
        : null;
      const metaParts = [extension, size, duration].filter(Boolean);
      const meta = metaParts.join(' • ');

      parts.push(
        `
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
      `,
        `<div class="media-link"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    if (caption) {
      parts.push(`<div>${caption.replaceAll('\n', '<br>')}</div>`);
    }

    return parts.length > 0 ? parts.join('') : `[${t('video')}]`;
  }

  private formatAudioMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'audio') {
      return '';
    }

    const audioUrl = content.audio?.url ?? '';
    const parts: string[] = [];

    if (audioUrl) {
      const escapedUrl = this.escapeHtml(audioUrl);
      const duration = content.audio?.duration
        ? this.formatAudioTime(content.audio.duration)
        : '0:00';

      parts.push(
        `
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
      `,
        `<div class="media-link"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    return parts.length > 0 ? parts.join('') : `[${t('audio')}]`;
  }

  private formatDocumentMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'document') {
      return '';
    }

    const documentUrl = content.document?.url ?? '';
    const parts: string[] = [];

    if (documentUrl) {
      const escapedUrl = this.escapeHtml(documentUrl);
      const name = content.document?.name ?? t('document');
      const extension = content.document?.extension?.toUpperCase() ?? 'FILE';
      const size = content.document?.size
        ? this.formatDocumentSize(content.document.size)
        : null;
      const meta = size ? `${extension} • ${size}` : extension;

      parts.push(
        `
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
      `,
        `<div class="media-link"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    return parts.length > 0 ? parts.join('') : `[${t('document')}]`;
  }

  private formatLocationMessage(
    content: ContentMessageChat,
    t: TFunction<'translation', undefined>
  ): string {
    if (content.type !== 'location') {
      return '';
    }

    const location = content.location;
    const parts: string[] = [];

    if (location?.latitude && location?.longitude) {
      parts.push(this.generateLocationMapHtml(location));
    }

    if (location?.name || location?.address) {
      parts.push(this.generateLocationInfoHtml(location));
    }

    if (location?.latitude && location?.longitude) {
      const googleMapsUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
      const escapedUrl = this.escapeHtml(googleMapsUrl);
      parts.push(
        `<div class="media-link" style="margin-top: 8px;"><b>${t('link')}:</b> <a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a></div>`
      );
    }

    return parts.length > 0 ? parts.join('') : `[${t('location')}]`;
  }

  private generateLocationMapHtml(location: LocationMessageChat): string {
    return `
      <div class="location-map-preview" style="
        width: 200px;
        max-width: 100%;
        height: 112px;
        border-radius: 8px 8px 0 0;
        overflow: hidden;
        margin-bottom: 0;
        position: relative;
        background: #e5e5e5;
      ">
        <div id="map-${location.latitude}-${location.longitude}" style="
          width: 100%;
          height: 100%;
          position: relative;
        "></div>
        <script>
          (function() {
            const mapId = 'map-${location.latitude}-${location.longitude}';
            let mapInitialized = false;
            
            function initMap() {
              if (mapInitialized) return;
              if (typeof maplibregl === 'undefined') return;
              
              const container = document.getElementById(mapId);
              if (!container) return;
              
              mapInitialized = true;
              
              const map = new maplibregl.Map({
                container: mapId,
                style: {
                  version: 8,
                  sources: {
                    'osm-tiles': {
                      type: 'raster',
                      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                      tileSize: 256,
                      attribution: '&copy; OpenStreetMap contributors'
                    }
                  },
                  layers: [{
                    id: 'osm-tiles-layer',
                    type: 'raster',
                    source: 'osm-tiles',
                    minzoom: 0,
                    maxzoom: 22
                  }]
                },
                center: [${location.longitude}, ${location.latitude}],
                zoom: 15,
                interactive: false,
                attributionControl: false
              });
              
              map.on('load', function() {
                new maplibregl.Marker({ color: '#ef4444' })
                  .setLngLat([${location.longitude}, ${location.latitude}])
                  .addTo(map);
              });
              
              map.on('data', function() {
                if (map.loaded() && map.isStyleLoaded()) {
                  container.setAttribute('data-map-loaded', 'true');
                }
              });
              
              map.on('idle', function() {
                if (map.loaded() && map.isStyleLoaded()) {
                  container.setAttribute('data-map-loaded', 'true');
                }
              });
              
              setTimeout(function() {
                if (map.loaded() && map.isStyleLoaded()) {
                  container.setAttribute('data-map-loaded', 'true');
                }
              }, 3000);
            }
            
            function tryInit() {
              if (typeof maplibregl !== 'undefined') {
                initMap();
              } else {
                setTimeout(tryInit, 100);
              }
            }
            
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
              setTimeout(tryInit, 500);
            } else {
              window.addEventListener('load', function() {
                setTimeout(tryInit, 500);
              });
              document.addEventListener('DOMContentLoaded', function() {
                setTimeout(tryInit, 500);
              });
            }
            
            setTimeout(tryInit, 1000);
          })();
        </script>
      </div>
    `;
  }

  private generateLocationInfoHtml(location: LocationMessageChat): string {
    const locationName = location.name ?? '';
    const locationAddress = location.address ?? '';
    const marginBottom = locationAddress ? '4px' : '0';
    return `
      <div class="location-info" style="
        padding: 12px;
        ${location?.latitude && location?.longitude ? 'border-radius: 0 0 8px 8px;' : 'border-radius: 8px;'}
      ">
        ${
          locationName
            ? `<div class="location-name" style="
          font-weight: 500;
          margin-bottom: ${marginBottom};
          font-size: 14px;
        ">${this.escapeHtml(locationName)}</div>`
            : ''
        }
        ${
          locationAddress
            ? `<div class="location-address" style="
          font-size: 12px;
          color: rgba(17, 27, 33, 0.7);
          word-break: break-word;
        ">${this.escapeHtml(locationAddress)}</div>`
            : ''
        }
      </div>
    `;
  }

  private formatAnnotationMessage(content: ContentMessageChat): string {
    if (content.type === EMessageType.annotation && content.message) {
      return content.message.replaceAll('\n', '<br>');
    }
    return '';
  }

  private formatMessageContent(
    content: ContentMessageChat,
    msg: ListMessageResult,
    t: TFunction<'translation', undefined>
  ): string {
    if (!content) {
      return '';
    }

    const systemMessage = this.formatSystemMessage(content);
    if (systemMessage) return systemMessage;

    const textMessage = this.formatTextMessage(content, msg, t);
    if (textMessage) return textMessage;

    const imageMessage = this.formatImageMessage(content, t);
    if (imageMessage) return imageMessage;

    const stickerMessage = this.formatStickerMessage(content, t);
    if (stickerMessage) return stickerMessage;

    const videoMessage = this.formatVideoMessage(content, t);
    if (videoMessage) return videoMessage;

    const audioMessage = this.formatAudioMessage(content, t);
    if (audioMessage) return audioMessage;

    const documentMessage = this.formatDocumentMessage(content, t);
    if (documentMessage) return documentMessage;

    const locationMessage = this.formatLocationMessage(content, t);
    if (locationMessage) return locationMessage;

    if (content.type === 'contact_card') {
      const contact = content.contact;
      if (!contact) {
        return `[${t('contact')}]`;
      }
      return this.formatContactCard(contact, msg, content.message);
    }

    const annotationMessage = this.formatAnnotationMessage(content);
    if (annotationMessage) return annotationMessage;

    return `[${t('unsupported_message')}]`;
  }

  private escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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
    let phoneNumbers = phone.replaceAll(/\D/g, '');
    let phoneDdi = ddi;

    if (phoneDdi) {
      if (phoneNumbers.startsWith(phoneDdi)) {
        phoneNumbers = phoneNumbers.slice(phoneDdi.length);
      }
    } else {
      const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;
      const extracted = extractPhoneAndDdi(phoneWithPlus);

      if (extracted) {
        phoneDdi = extracted.phone_ddi;
        phoneNumbers = extracted.phone;
      } else if (phoneNumbers.length > 11) {
        phoneDdi = phoneNumbers.slice(0, 2);
        phoneNumbers = phoneNumbers.slice(2);
      }
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

  private formatLinkPreview(
    linkPreview: LinkPreview | WAUrlInfo,
    msg: ListMessageResult
  ): string {
    if (!linkPreview?.title) {
      return '';
    }

    const isUser = msg.type_user === ETypeUserChat.client;
    const previewImage = this.resolvePreviewImage(linkPreview);
    const previewUrl = this.resolvePreviewUrl(linkPreview);
    const domain = this.domainFromUrl(previewUrl);
    const title = linkPreview.title ?? '';
    const description = linkPreview.description ?? '';

    const backgroundColor = isUser
      ? 'rgb(243, 244, 246)'
      : 'rgb(214, 243, 207)';
    const textColor = 'rgb(17, 27, 33)';

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
          word-break: break-word;
          overflow-wrap: anywhere;
        ">${this.escapeHtml(previewUrl)}</a>
      `);
    }

    parts.push('</div>');

    return parts.join('');
  }

  private resolvePreviewImage(linkPreview?: LinkPreview | WAUrlInfo): string {
    if (!linkPreview) {
      return '';
    }

    if (linkPreview.originalThumbnailUrl) {
      return linkPreview.originalThumbnailUrl;
    }

    if (linkPreview.highQualityThumbnail) {
      return typeof linkPreview.highQualityThumbnail === 'string'
        ? linkPreview.highQualityThumbnail
        : '';
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

  private resolvePreviewUrl(linkPreview?: LinkPreview | WAUrlInfo): string {
    if (!linkPreview) {
      return '';
    }

    return linkPreview['canonical-url'] ?? linkPreview['matched-text'] ?? '';
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

  private getContactPhoneDisplay(contact: IContactMessage): string {
    if (!contact.contact_id) {
      return contact.phone_partial ?? '';
    }

    const phone = this.contactPhoneCache.get(contact.contact_id);
    if (!phone) {
      return contact.phone_partial ?? '';
    }

    const phoneDdi = contact.phone_ddi ?? null;
    if (phoneDdi) {
      const phoneDigits = phone.replaceAll(/\D/g, '');
      const fullPhone = `${phoneDdi}${phoneDigits}`;
      return this.formatPhone(fullPhone, phoneDdi);
    }

    return this.formatPhone(phone, null);
  }

  private generateContactAvatarHtml(
    contactPhoto: string,
    fullName: string,
    hasPhoto: boolean
  ): string {
    const backgroundColor = hasPhoto
      ? 'transparent'
      : 'rgba(25, 118, 210, 0.12)';
    return `
          <div style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            overflow: visible;
            flex-shrink: 0;
            background-color: ${backgroundColor};
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
              background-color: ${backgroundColor};
            " />
          </div>`;
  }

  private generateContactInfoHtml(
    fullName: string,
    phoneDisplay: string,
    textColor: string
  ): string {
    const marginBottom = phoneDisplay ? '2px' : '0';
    const phoneHtml = phoneDisplay
      ? `<div style="
          font-size: 12px;
          color: rgba(17, 27, 33, 0.6);
        ">${this.escapeHtml(phoneDisplay)}</div>`
      : '';

    return `
          <div style="flex: 1; min-width: 0;">
            <div style="
              font-size: 14px;
              font-weight: 500;
              color: ${textColor};
              margin-bottom: ${marginBottom};
            ">${this.escapeHtml(fullName)}</div>
            ${phoneHtml}
          </div>`;
  }

  private generateContactMessageHtml(
    message: string | null | undefined,
    textColor: string
  ): string {
    if (!message) {
      return '';
    }

    return `
        <p style="
          margin-top: 8px;
          margin-bottom: 0;
          white-space: pre-wrap;
          word-break: break-word;
          color: ${textColor};
          font-size: 14px;
          line-height: 1.5;
        ">${this.escapeHtml(message.replaceAll('\n', '<br>'))}</p>`;
  }

  private formatContactCard(
    contact: IContactMessage,
    msg: ListMessageResult,
    message: string | null | undefined
  ): string {
    const isUser = msg.type_user === ETypeUserChat.client;
    const hasPhoto = !!contact.photo;
    const contactPhoto =
      hasPhoto && contact.photo ? contact.photo : this.getDefaultAvatar();
    const contactName = contact.name ?? '';
    const contactLastName = contact.last_name ?? '';
    const fullName = contactLastName
      ? `${contactName} ${contactLastName}`
      : contactName;

    const phoneDisplay = this.getContactPhoneDisplay(contact);

    const backgroundColor = isUser
      ? 'rgba(255, 255, 255, 0.5)'
      : 'rgba(255, 255, 255, 0.3)';
    const textColor = 'rgb(17, 27, 33)';

    const avatarHtml = this.generateContactAvatarHtml(
      contactPhoto,
      fullName,
      hasPhoto
    );
    const infoHtml = this.generateContactInfoHtml(
      fullName,
      phoneDisplay,
      textColor
    );
    const messageHtml = this.generateContactMessageHtml(message, textColor);

    return `
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
          ${avatarHtml}
          ${infoHtml}
        </div>
        ${messageHtml}
      </div>
    `;
  }

  private generateHeaderHtml(
    chat: IChat | null,
    messages: ListMessageResult[],
    t: TFunction<'translation', undefined>
  ): string {
    if (!chat) {
      return '';
    }

    const name = chat.name ?? chat.contact?.name ?? '-';
    const phone = chat.phone ?? '';
    const phoneDdi = chat.contact?.phone_ddi ?? null;
    const formattedPhone = phone ? this.formatPhone(phone, phoneDdi) : '-';
    const sector = chat.sector?.name ?? '-';

    const firstMessage = messages.length > 0 ? messages[0] : null;
    const lastMessage = messages.length > 0 ? (messages.at(-1) ?? null) : null;

    const firstMessageDate = firstMessage?.date ?? null;
    const lastMessageDate = lastMessage?.date ?? null;

    const attendanceDate = firstMessageDate
      ? this.formatFullDateTime(firstMessageDate, t)
      : '-';
    const closingDate = lastMessageDate
      ? this.formatFullDateTime(lastMessageDate, t)
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
      lastMessageDate,
      t
    );

    const averageResponseTime = this.calculateAverageResponseTime(messages, t);

    return `
      <div class="header">
        <div class="header-row">
          <div class="header-label">${t('name')}:</div>
          <div class="header-value">${this.escapeHtml(name)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('phone')}:</div>
          <div class="header-value">${this.escapeHtml(formattedPhone)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('attendance_date')}:</div>
          <div class="header-value">${this.escapeHtml(attendanceDate)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('closing_date')}:</div>
          <div class="header-value">${this.escapeHtml(closingDate)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('sector')}:</div>
          <div class="header-value">${this.escapeHtml(sector)}</div>
        </div>
        <div class="header-divider"></div>
        <div class="header-row">
          <div class="header-label">${t('attendance_protocol')}:</div>
          <div class="header-value">${this.escapeHtml(protocolStart)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('transfer_protocol')}:</div>
          <div class="header-value">${this.escapeHtml(protocolTransfer)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('ura_protocol')}:</div>
          <div class="header-value">${this.escapeHtml(protocolUra)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('attendance_time')}:</div>
          <div class="header-value">${this.escapeHtml(attendanceTime)}</div>
        </div>
        <div class="header-row">
          <div class="header-label">${t('average_response_time')}:</div>
          <div class="header-value">${this.escapeHtml(averageResponseTime)}</div>
        </div>
      </div>
    `;
  }

  private formatFullDateTime(
    dateString: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${t('at')} ${hours}:${minutes}`;
  }

  private calculateAttendanceTime(
    startDate: string | null,
    endDate: string | null,
    t: TFunction<'translation', undefined>
  ): string {
    if (!startDate || !endDate) {
      return '-';
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
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
        return `${diffDays}${t('day_abbrev')} ${hours}${t('hour_abbrev')} ${minutes}${t('minute_abbrev')}`;
      }
      return `${diffDays}${t('day_abbrev')} ${minutes}${t('minute_abbrev')}`;
    }

    if (diffHours > 0) {
      const minutes = diffMinutes % 60;
      if (minutes > 0) {
        return `${diffHours}${t('hour_abbrev')} ${minutes}${t('minute_abbrev')}`;
      }
      return `${diffHours}${t('hour_abbrev')}`;
    }

    if (diffMinutes > 0) {
      const seconds = diffSeconds % 60;
      if (seconds > 0) {
        return `${diffMinutes}${t('minute_abbrev')} ${seconds}${t('second_abbrev')}`;
      }
      return `${diffMinutes}${t('minute_abbrev')}`;
    }

    return `${diffSeconds}${t('second_abbrev')}`;
  }

  private collectResponseTimes(messages: ListMessageResult[]): number[] {
    const responseTimes: number[] = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const currentMsg = messages[i];
      const nextMsg = messages[i + 1];

      if (
        currentMsg.type_user !== ETypeUserChat.client ||
        nextMsg.type_user !== ETypeUserChat.operator
      ) {
        continue;
      }

      const currentDate = new Date(currentMsg.date ?? '');
      const nextDate = new Date(nextMsg.date ?? '');

      if (
        Number.isNaN(currentDate.getTime()) ||
        Number.isNaN(nextDate.getTime())
      ) {
        continue;
      }

      const diffMs = nextDate.getTime() - currentDate.getTime();
      if (diffMs >= 0) {
        responseTimes.push(diffMs);
      }
    }

    return responseTimes;
  }

  private formatAverageTime(
    averageMs: number,
    t: TFunction<'translation', undefined>
  ): string {
    const averageSeconds = Math.floor(averageMs / 1000);
    const averageMinutes = Math.floor(averageSeconds / 60);
    const averageHours = Math.floor(averageMinutes / 60);
    const averageDays = Math.floor(averageHours / 24);

    if (averageDays > 0) {
      return this.formatDaysTime(averageDays, averageHours, averageMinutes, t);
    }

    if (averageHours > 0) {
      return this.formatHoursTime(averageHours, averageMinutes, t);
    }

    if (averageMinutes > 0) {
      return this.formatMinutesTime(averageMinutes, averageSeconds, t);
    }

    return `${averageSeconds}${t('second_abbrev')}`;
  }

  private formatDaysTime(
    days: number,
    hours: number,
    minutes: number,
    t: TFunction<'translation', undefined>
  ): string {
    const hoursRemainder = hours % 24;
    const minutesRemainder = minutes % 60;

    if (hoursRemainder > 0) {
      return `${days}${t('day_abbrev')} ${hoursRemainder}${t('hour_abbrev')} ${minutesRemainder}${t('minute_abbrev')}`;
    }

    return `${days}${t('day_abbrev')} ${minutesRemainder}${t('minute_abbrev')}`;
  }

  private formatHoursTime(
    hours: number,
    minutes: number,
    t: TFunction<'translation', undefined>
  ): string {
    const minutesRemainder = minutes % 60;

    if (minutesRemainder > 0) {
      return `${hours}${t('hour_abbrev')} ${minutesRemainder}${t('minute_abbrev')}`;
    }

    return `${hours}${t('hour_abbrev')}`;
  }

  private formatMinutesTime(
    minutes: number,
    seconds: number,
    t: TFunction<'translation', undefined>
  ): string {
    const secondsRemainder = seconds % 60;

    if (secondsRemainder > 0) {
      return `${minutes}${t('minute_abbrev')} ${secondsRemainder}${t('second_abbrev')}`;
    }

    return `${minutes}${t('minute_abbrev')}`;
  }

  private calculateAverageResponseTime(
    messages: ListMessageResult[],
    t: TFunction<'translation', undefined>
  ): string {
    if (messages.length < 2) {
      return '-';
    }

    const responseTimes = this.collectResponseTimes(messages);

    if (responseTimes.length === 0) {
      return '-';
    }

    const totalMs = responseTimes.reduce((sum, time) => sum + time, 0);
    const averageMs = totalMs / responseTimes.length;

    return this.formatAverageTime(averageMs, t);
  }

  private generateQuotedImageHtml(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    const imageSrc = this.resolveQuotedImageSrc(quoted);
    const imageName = this.resolveQuotedImageName(t);
    const imageMeta = this.resolveQuotedImageMeta(quoted);

    return `
        <div class="quoted-media quoted-media--image">
          <img src="${this.escapeHtml(imageSrc)}" alt="${t('image')}" />
        </div>
        <div class="quoted-image-info">
          <span class="quoted-image-name">${this.escapeHtml(imageName)}</span>
          ${imageMeta ? `<span class="quoted-image-meta">${this.escapeHtml(imageMeta)}</span>` : ''}
        </div>
      `;
  }

  private generateQuotedLocationHtml(
    t: TFunction<'translation', undefined>
  ): string {
    return `
        <div class="quoted-location">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: rgb(25, 118, 210);">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
          <div class="quoted-location-info">
            <span class="quoted-location-name">${t('location')}</span>
          </div>
        </div>
      `;
  }

  private generateQuotedDocumentHtml(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    const docName = this.resolveQuotedDocumentName(quoted, t);
    const docMeta = this.resolveQuotedDocumentMeta(quoted);
    const docIcon = this.resolveQuotedDocumentIcon(quoted);

    return `
        <div class="quoted-document">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 26px; height: 26px; fill: rgb(25, 118, 210);">
            ${this.getDocumentIconSvg(docIcon)}
          </svg>
          <div class="quoted-document-info">
            <span class="quoted-document-name">${this.escapeHtml(docName)}</span>
            ${docMeta ? `<span class="quoted-document-meta">${this.escapeHtml(docMeta)}</span>` : ''}
          </div>
        </div>
      `;
  }

  private generateQuotedStickerHtml(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    const stickerSrc = this.resolveQuotedStickerSrc(quoted);

    return `
        <div class="quoted-sticker">
          <div class="quoted-media quoted-media--image">
            <img src="${this.escapeHtml(stickerSrc)}" alt="${t('sticker')}" style="object-fit: contain;" />
          </div>
        </div>
      `;
  }

  private generateQuotedVideoHtml(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    const videoUrl = this.resolveQuotedVideoUrl(quoted);
    const videoPoster = this.resolveQuotedVideoPoster(quoted);
    const videoName = this.resolveQuotedVideoName(t);
    const videoMeta = this.resolveQuotedVideoMeta(quoted);

    const videoThumbHtml = videoUrl
      ? `<img src="${this.escapeHtml(videoPoster ?? videoUrl)}" alt="${t('video')}" class="quoted-video-thumb" />
               <div class="quoted-video-overlay">
                 <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 16px; height: 16px; fill: white;">
                   <path d="M8 5v14l11-7z"/>
                 </svg>
               </div>`
      : `<div class="quoted-video-placeholder">
                 <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 20px; height: 20px; fill: rgba(17, 27, 33, 0.6);">
                   <path d="M8 5v14l11-7z"/>
                 </svg>
               </div>`;

    return `
        <div class="quoted-media quoted-media--video" style="position: relative;">
          ${videoThumbHtml}
        </div>
        <div class="quoted-video-info">
          <span class="quoted-video-name">${this.escapeHtml(videoName)}</span>
          ${videoMeta ? `<span class="quoted-video-meta">${this.escapeHtml(videoMeta)}</span>` : ''}
        </div>
      `;
  }

  private generateQuotedAudioHtml(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    const audioName = this.resolveQuotedAudioName(t);
    const audioMeta = this.resolveQuotedAudioMeta(quoted);

    return `
        <div class="quoted-audio">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: rgb(25, 118, 210);">
            <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
          </svg>
          <div class="quoted-audio-info">
            <span class="quoted-audio-name">${this.escapeHtml(audioName)}</span>
            ${audioMeta ? `<span class="quoted-audio-meta">${this.escapeHtml(audioMeta)}</span>` : ''}
          </div>
        </div>
      `;
  }

  private generateQuotedContactHtml(
    t: TFunction<'translation', undefined>
  ): string {
    return `
        <div class="quoted-contact">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: rgb(25, 118, 210);">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
          </svg>
          <div class="quoted-contact-info">
            <span class="quoted-contact-name">${t('contact')}</span>
          </div>
        </div>
      `;
  }

  private shouldShowQuotedText(quotedType: string): boolean {
    return (
      quotedType !== EMessageType.video &&
      quotedType !== EMessageType.image &&
      quotedType !== EMessageType.audio &&
      quotedType !== EMessageType.sticker &&
      quotedType !== EMessageType.location &&
      quotedType !== EMessageType.contact_card
    );
  }

  private shouldFormatQuotedText(quotedType: string): boolean {
    return (
      quotedType === EMessageType.text ||
      quotedType === EMessageType.system ||
      quotedType === EMessageType.annotation
    );
  }

  private generateQuotedTextHtml(
    quotedText: string,
    quotedType: string
  ): string {
    const shouldFormat = this.shouldFormatQuotedText(quotedType);
    const formattedText = shouldFormat
      ? quotedText.replaceAll('\n', '<br>')
      : this.escapeHtml(quotedText);

    return `
        <div class="quoted-text">
          ${formattedText}
        </div>
      `;
  }

  private formatQuoted(
    msg: ListMessageResult,
    clientName: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (!msg.content?.quoted) {
      return '';
    }

    const quoted = msg.content.quoted;
    const isUser = msg.type_user === ETypeUserChat.client;
    const isRight = !isUser;
    const quotedName = this.resolveQuotedName(quoted, clientName, t);
    const quotedType = quoted.type ?? '';

    const parts: string[] = [];

    parts.push(`
      <div class="quoted-block ${isRight ? 'is-right' : ''}">
        <div class="quoted-name">${this.escapeHtml(quotedName)}</div>
        <div class="quoted-content">
    `);

    if (this.hasQuotedImage(quoted)) {
      parts.push(this.generateQuotedImageHtml(quoted, t));
    }

    if (this.hasQuotedLocation(quoted as QuotedMessageType)) {
      parts.push(this.generateQuotedLocationHtml(t));
    }

    if (this.hasQuotedDocument(quoted)) {
      parts.push(this.generateQuotedDocumentHtml(quoted, t));
    }

    if (this.hasQuotedSticker(quoted)) {
      parts.push(this.generateQuotedStickerHtml(quoted, t));
    }

    if (this.hasQuotedVideo(quoted)) {
      parts.push(this.generateQuotedVideoHtml(quoted, t));
    }

    if (this.hasQuotedAudio(quoted)) {
      parts.push(this.generateQuotedAudioHtml(quoted, t));
    }

    if (this.hasQuotedContact(quoted)) {
      parts.push(this.generateQuotedContactHtml(t));
    }

    const quotedText = this.resolveQuotedText(quoted, quotedType, t);
    if (quotedText && this.shouldShowQuotedText(quotedType)) {
      parts.push(this.generateQuotedTextHtml(quotedText, quotedType));
    }

    parts.push(`
        </div>
      </div>
    `);

    return parts.join('');
  }

  private resolveQuotedName(
    quoted: QuotedMessageType,
    clientName: string,
    t: TFunction<'translation', undefined>
  ): string {
    const fromMe = quoted?.key?.from_me ?? null;
    if (fromMe === true) return t('operator');
    if (fromMe === false) return this.getFirstName(clientName, t);
    return '';
  }

  private resolveQuotedText(
    quoted: QuotedMessageType,
    quotedType: string,
    t: TFunction<'translation', undefined>
  ): string {
    if (!quoted) {
      return '';
    }

    if (quotedType === EMessageType.image || quoted.image) {
      return quoted.image?.caption ?? t('photo');
    }

    if (quotedType === EMessageType.document && quoted.document) {
      return quoted.message ?? '';
    }

    if (quotedType === EMessageType.video) {
      return quoted.video?.caption ?? '';
    }

    if (quotedType === EMessageType.audio) {
      return quoted.message ?? t('audio');
    }

    if (quotedType === EMessageType.sticker) {
      return t('sticker');
    }

    if (quotedType === EMessageType.location) {
      return quoted.location?.name ?? quoted.location?.address ?? t('location');
    }

    return quoted.message ?? '';
  }

  private resolveQuotedImageSrc(quoted: QuotedMessageType): string {
    const image = quoted?.image;
    if (!image) return '';
    return image.url ?? image.thumbnail ?? '';
  }

  private hasQuotedImage(quoted: QuotedMessageType): boolean {
    const image = quoted?.image;
    if (!image) return false;
    return !!(image.url ?? image.thumbnail);
  }

  private hasQuotedVideo(quoted: QuotedMessageType): boolean {
    return !!quoted?.video;
  }

  private hasQuotedAudio(quoted: QuotedMessageType): boolean {
    return !!quoted?.audio;
  }

  private hasQuotedSticker(quoted: QuotedMessageType): boolean {
    return !!quoted?.sticker;
  }

  private hasQuotedLocation(
    quoted: QuotedMessageType | IQuotedMessage
  ): boolean {
    return !!(quoted?.type === EMessageType.location && quoted.location);
  }

  private hasQuotedContact(quoted: QuotedMessageType): boolean {
    return !!(quoted?.type === EMessageType.contact_card && quoted.contact);
  }

  private hasQuotedDocument(quoted: QuotedMessageType): boolean {
    if (!quoted) return false;
    return quoted.type === EMessageType.document && !!quoted.document;
  }

  private resolveQuotedDocumentIcon(
    quoted: QuotedMessageType | IQuotedMessage
  ): string {
    const ext = quoted?.document?.extension?.toLowerCase();
    const documentIconMap: Record<string, string> = {
      pdf: 'pdf',
      doc: 'doc',
      docx: 'doc',
      xls: 'xls',
      xlsx: 'xls',
      csv: 'xls',
      ppt: 'ppt',
      pptx: 'ppt',
      zip: 'zip',
      rar: 'zip',
      '7z': 'zip',
    };

    if (ext && documentIconMap[ext]) {
      return documentIconMap[ext];
    }

    const mimetype = quoted?.document?.mimetype ?? '';
    if (mimetype.includes('pdf')) return 'pdf';
    if (mimetype.includes('word')) return 'doc';
    if (mimetype.includes('sheet') || mimetype.includes('excel')) return 'xls';
    if (mimetype.includes('presentation')) return 'ppt';
    if (mimetype.includes('zip') || mimetype.includes('compressed'))
      return 'zip';

    return 'file';
  }

  private getDocumentIconSvg(iconType: string): string {
    const icons: Record<string, string> = {
      pdf: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
      doc: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
      xls: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
      ppt: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
      zip: '<path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"/>',
      file: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
    };

    return icons[iconType] ?? icons.file;
  }

  private resolveQuotedDocumentName(
    quoted: QuotedMessageType,
    t: TFunction<'translation', undefined>
  ): string {
    return quoted?.document?.name ?? t('document');
  }

  private resolveQuotedDocumentMeta(quoted: QuotedMessageType): string {
    const doc = quoted?.document;
    if (!doc) return '';
    const ext = doc.extension ? doc.extension.toUpperCase() : 'FILE';
    if (!doc.size) return ext;
    return `${ext} • ${this.formatDocumentSize(doc.size)}`;
  }

  private resolveQuotedImageName(
    t: TFunction<'translation', undefined>
  ): string {
    return t('photo');
  }

  private resolveQuotedImageMeta(quoted: QuotedMessageType): string {
    const image = quoted?.image;
    if (!image) return '';
    const ext = image.extension ? image.extension.toUpperCase() : 'IMAGE';
    const size = image.size ? this.formatDocumentSize(image.size) : null;
    return [ext, size].filter(Boolean).join(' • ');
  }

  private resolveQuotedVideoName(
    t: TFunction<'translation', undefined>
  ): string {
    return t('video');
  }

  private resolveQuotedVideoUrl(quoted: QuotedMessageType): string {
    return quoted?.video?.url ?? '';
  }

  private resolveQuotedVideoPoster(quoted: QuotedMessageType): string {
    return quoted?.video?.thumbnail ?? '';
  }

  private resolveQuotedVideoMeta(quoted: QuotedMessageType): string {
    const video = quoted?.video;
    if (!video) return '';
    const ext = video.extension ? video.extension.toUpperCase() : 'VIDEO';
    const size = video.size ? this.formatDocumentSize(video.size) : null;
    const duration = this.formatVideoDuration(video.duration);
    return [ext, size, duration].filter(Boolean).join(' • ');
  }

  private resolveQuotedAudioName(
    t: TFunction<'translation', undefined>
  ): string {
    return t('audio');
  }

  private resolveQuotedAudioMeta(quoted: QuotedMessageType): string {
    const audio = quoted?.audio;
    if (!audio) return '';
    const size = audio.size ? this.formatDocumentSize(audio.size) : null;
    const duration = this.formatVideoDuration(audio.duration);
    return [size, duration].filter(Boolean).join(' • ');
  }

  private resolveQuotedStickerSrc(quoted: QuotedMessageType): string {
    return quoted?.sticker?.url ?? '';
  }
}
