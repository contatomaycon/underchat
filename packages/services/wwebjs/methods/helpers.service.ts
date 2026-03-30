import { injectable, inject } from 'tsyringe';
import whatsappWeb, { type Client } from '@wwebjs/whatsapp-web.js';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { webcrypto as nodeCrypto } from 'node:crypto';
import { WwebjsDeliveryConfirmationService } from './deliveryConfirmation.service';
import { MessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';

const { MessageMedia } = whatsappWeb;

@injectable()
export class WwebjsHelpersService {
  private readonly SEND_CONFIRMATION_MAX_ATTEMPTS = 1;
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;

  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService,
    @inject(WwebjsDeliveryConfirmationService)
    private readonly deliveryConfirmation: WwebjsDeliveryConfirmationService
  ) {}

  getClient(): Client {
    const c = this.connection.getSocket();
    if (!c) {
      throw new Error('Wwebjs client not connected');
    }
    return c;
  }

  async sendMessage(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    if (this.shouldSimulateTyping(content, options)) {
      await this.simulateHumanTyping(jid, content, options);
    }

    return this.sendMessageWithConfirmation(jid, content, options);
  }

  private async sendMessageWithConfirmation(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    const startedAt = Date.now();
    const contentInfo = this.describeOutgoingContent(content, options);
    const optionsInfo = this.describeSendOptions(options);
    console.info('[WwebjsSend] send_start', {
      jid,
      content: contentInfo,
      options: optionsInfo,
    });

    const client = this.getClient();
    let sentMessage: Awaited<ReturnType<Client['sendMessage']>>;
    try {
      sentMessage = await this.sendMessageRaw(client, jid, content, options);
    } catch (error) {
      console.error('[WwebjsSend] send_failed_before_ack', {
        jid,
        content: contentInfo,
        options: optionsInfo,
        duration_ms: Date.now() - startedAt,
        error: this.describeError(error),
      });
      throw error;
    }

    const sentMessageId = this.extractMessageId(sentMessage);
    if (!sentMessageId) {
      console.error('[WwebjsSend] send_failed_without_message_id', {
        jid,
        content: contentInfo,
        options: optionsInfo,
        duration_ms: Date.now() - startedAt,
      });
      throw new Error('Wwebjs send returned message without id');
    }

    console.info('[WwebjsSend] send_dispatched', {
      jid,
      message_id: sentMessageId,
      content: contentInfo,
      options: optionsInfo,
      duration_ms: Date.now() - startedAt,
    });

    const outcome = await this.deliveryConfirmation.waitForOutcome(
      sentMessageId,
      this.SEND_CONFIRMATION_TIMEOUT_MS
    );

    if (outcome === 'sent') {
      console.info('[WwebjsSend] send_ack_sent', {
        jid,
        message_id: sentMessageId,
        content: contentInfo,
        options: optionsInfo,
        duration_ms: Date.now() - startedAt,
      });
      return sentMessage;
    }

    const lastOutcome = outcome === 'failed' ? 'failed' : 'timeout';
    const confirmationError =
      outcome === 'failed'
        ? new Error(
            `Message delivery failed acknowledgement for ${sentMessageId}`
          )
        : new Error(
            `Message delivery confirmation timeout for ${sentMessageId}`
          );

    console.warn('[WwebjsSend] send_ack_not_confirmed', {
      jid,
      message_id: sentMessageId,
      outcome: lastOutcome,
      content: contentInfo,
      options: optionsInfo,
      duration_ms: Date.now() - startedAt,
      error: this.describeError(confirmationError),
    });

    throw new MessageDeliveryConfirmationFailedError({
      maxAttempts: this.SEND_CONFIRMATION_MAX_ATTEMPTS,
      lastMessageId: sentMessageId,
      lastOutcome,
      cause: confirmationError,
    });
  }

  private async sendMessageRaw(
    client: Client,
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Promise<Awaited<ReturnType<Client['sendMessage']>>> {
    const normalizedJid = this.normalizeSendJidCandidate(jid);
    if (!normalizedJid) {
      throw new Error('Wwebjs sendMessage received empty jid');
    }

    const sendOptions = {
      ...(options ?? {}),
      waitUntilMsgSent: true,
    } as Parameters<Client['sendMessage']>[2];
    const contentInfo = this.describeOutgoingContent(content, sendOptions);
    const optionsInfo = this.describeSendOptions(sendOptions);

    const sendWithJid = (targetJid: string) =>
      client.sendMessage(targetJid, content, sendOptions);

    console.info('[WwebjsSend] send_attempt', {
      attempt: 1,
      original_jid: jid,
      target_jid: normalizedJid,
      content: contentInfo,
      options: optionsInfo,
    });

    return sendWithJid(normalizedJid).catch(async (firstError) => {
      console.warn('[WwebjsSend] send_attempt_failed', {
        attempt: 1,
        original_jid: jid,
        target_jid: normalizedJid,
        content: contentInfo,
        options: optionsInfo,
        error: this.describeError(firstError),
      });

      if (!this.shouldRetrySendWithAlternateJid(firstError)) {
        console.error('[WwebjsSend] send_attempt_failed_terminal', {
          attempt: 1,
          original_jid: jid,
          target_jid: normalizedJid,
          content: contentInfo,
          options: optionsInfo,
          error: this.describeError(firstError),
        });
        throw firstError;
      }

      const candidates = await this.buildAlternateJidCandidates(
        client,
        normalizedJid
      );
      console.info('[WwebjsSend] send_retry_candidates', {
        original_jid: jid,
        failed_target_jid: normalizedJid,
        candidates,
      });

      let lastError: unknown = firstError;
      let attempt = 1;

      for (const candidate of candidates) {
        if (candidate === normalizedJid) {
          continue;
        }

        attempt += 1;
        console.info('[WwebjsSend] send_attempt', {
          attempt,
          original_jid: jid,
          target_jid: candidate,
          content: contentInfo,
          options: optionsInfo,
        });

        try {
          const result = await sendWithJid(candidate);
          console.info('[WwebjsSend] send_attempt_succeeded', {
            attempt,
            original_jid: jid,
            target_jid: candidate,
          });
          return result;
        } catch (candidateError) {
          lastError = candidateError;
          console.warn('[WwebjsSend] send_attempt_failed', {
            attempt,
            original_jid: jid,
            target_jid: candidate,
            content: contentInfo,
            options: optionsInfo,
            error: this.describeError(candidateError),
          });
          if (!this.shouldRetrySendWithAlternateJid(candidateError)) {
            console.error('[WwebjsSend] send_attempt_failed_terminal', {
              attempt,
              original_jid: jid,
              target_jid: candidate,
              content: contentInfo,
              options: optionsInfo,
              error: this.describeError(candidateError),
            });
            throw candidateError;
          }
        }
      }

      console.error('[WwebjsSend] send_all_attempts_failed', {
        original_jid: jid,
        first_target_jid: normalizedJid,
        candidates,
        content: contentInfo,
        options: optionsInfo,
        error: this.describeError(lastError),
      });
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError));
    });
  }

  private describeError(error: unknown): {
    name?: string;
    message: string;
    stack?: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (typeof error === 'string') {
      return { message: error };
    }

    return { message: String(error ?? '') };
  }

  private describeSendOptions(
    options?: Parameters<Client['sendMessage']>[2]
  ): Record<string, unknown> {
    if (!options || typeof options !== 'object') {
      return {};
    }

    const raw = options as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys: Array<keyof typeof raw> = [
      'waitUntilMsgSent',
      'sendAudioAsVoice',
      'sendMediaAsSticker',
      'sendMediaAsDocument',
      'sendVideoAsGif',
      'sendMediaAsHd',
      'isViewOnce',
      'quotedMessageId',
      'parseVCards',
      'caption',
      'mentions',
      'groupMentions',
      'extra',
    ];

    for (const key of keys) {
      const value = raw[key];
      if (value === undefined) {
        continue;
      }

      if (key === 'caption' && typeof value === 'string') {
        result.caption_length = value.length;
        continue;
      }

      if (key === 'extra' && typeof value === 'object' && value !== null) {
        result.extra_keys = Object.keys(value as Record<string, unknown>);
        continue;
      }

      if (Array.isArray(value)) {
        result[String(key)] = { count: value.length };
        continue;
      }

      if (typeof value === 'object' && value !== null) {
        result[String(key)] = { type: 'object' };
        continue;
      }

      result[String(key)] = value;
    }

    return result;
  }

  private describeOutgoingContent(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Record<string, unknown> {
    const description: Record<string, unknown> = {};

    if (typeof content === 'string') {
      description.kind = 'text';
      description.length = content.length;
      description.has_link = /https?:\/\//i.test(content);
      return description;
    }

    if (!content || typeof content !== 'object') {
      description.kind = typeof content;
      return description;
    }

    const asAny = content as unknown as Record<string, unknown>;

    if (
      typeof asAny.latitude === 'number' &&
      typeof asAny.longitude === 'number'
    ) {
      description.kind = 'location';
      description.has_name =
        typeof asAny.name === 'string' && asAny.name.length > 0;
      description.has_address =
        typeof asAny.address === 'string' && asAny.address.length > 0;
      return description;
    }

    if (typeof asAny.pollName === 'string') {
      description.kind = 'poll';
      const pollOptions = asAny.pollOptions;
      description.options_count = Array.isArray(pollOptions)
        ? pollOptions.length
        : 0;
      return description;
    }

    if (typeof asAny.mimetype === 'string') {
      description.kind = 'media';
      description.mimetype = asAny.mimetype;
      if (typeof asAny.filesize === 'number') {
        description.filesize = asAny.filesize;
      }
      const caption = (options as { caption?: unknown } | undefined)?.caption;
      if (typeof caption === 'string') {
        description.caption_length = caption.length;
      }
      return description;
    }

    const textValue = asAny.text;
    if (typeof textValue === 'string') {
      description.kind = 'text_object';
      description.length = textValue.length;
      return description;
    }

    description.kind = 'object';
    description.keys = Object.keys(asAny);
    return description;
  }

  private normalizeSendJidCandidate(
    value: string | null | undefined
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length ? normalized : undefined;
  }

  private addJidCandidate(candidates: Set<string>, raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }

    const normalized = this.normalizeSendJidCandidate(raw);
    if (!normalized) {
      return;
    }

    candidates.add(normalized);

    if (!normalized.includes('@')) {
      const digits = onlyDigits(normalized);
      if (digits) {
        candidates.add(`${digits}@c.us`);
        candidates.add(`${digits}@s.whatsapp.net`);
      }
      return;
    }

    if (normalized.endsWith('@s.whatsapp.net')) {
      candidates.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
    } else if (normalized.endsWith('@c.us')) {
      candidates.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
    }
  }

  private isUserJid(jid: string): boolean {
    return (
      jid.endsWith('@s.whatsapp.net') ||
      jid.endsWith('@c.us') ||
      jid.endsWith('@lid')
    );
  }

  private shouldRetrySendWithAlternateJid(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : String(error ?? '');
    return /No LID for user/i.test(message) || /invalid wid/i.test(message);
  }

  private isLidJid(jid: string): boolean {
    return jid.endsWith('@lid');
  }

  private orderAlternateCandidates(
    candidates: string[],
    primaryJid: string
  ): string[] {
    const unique = Array.from(
      new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))
    );
    const withoutPrimary = unique.filter(
      (candidate) => candidate !== primaryJid
    );
    const lidCandidates = withoutPrimary.filter((candidate) =>
      this.isLidJid(candidate)
    );
    const otherCandidates = withoutPrimary.filter(
      (candidate) => !this.isLidJid(candidate)
    );

    return [primaryJid, ...lidCandidates, ...otherCandidates];
  }

  private async buildAlternateJidCandidates(
    client: Client,
    jid: string
  ): Promise<string[]> {
    const candidates = new Set<string>();
    this.addJidCandidate(candidates, jid);

    if (!this.isUserJid(jid)) {
      return Array.from(candidates);
    }

    const getContactLidAndPhone = (
      client as unknown as {
        getContactLidAndPhone?: (
          userIds: string[] | string
        ) => Promise<
          | Array<{ lid?: string; pn?: string }>
          | { lid?: string; pn?: string }
          | null
        >;
      }
    ).getContactLidAndPhone;

    if (typeof getContactLidAndPhone === 'function') {
      for (const candidate of Array.from(candidates)) {
        if (!this.isUserJid(candidate)) {
          continue;
        }
        try {
          const resolved = await getContactLidAndPhone.call(client, [
            candidate,
          ]);
          const first = Array.isArray(resolved) ? resolved[0] : resolved;
          if (first && typeof first === 'object') {
            this.addJidCandidate(candidates, (first as { lid?: unknown }).lid);
            this.addJidCandidate(candidates, (first as { pn?: unknown }).pn);
          }
        } catch {}
      }
    }

    return this.orderAlternateCandidates(Array.from(candidates), jid);
  }

  private extractMessageId(
    message: Awaited<ReturnType<Client['sendMessage']>>
  ): string | undefined {
    if (!message || typeof message !== 'object') {
      return undefined;
    }

    const messageId = (message as { id?: unknown }).id;
    if (!messageId) {
      return undefined;
    }

    if (
      typeof messageId === 'object' &&
      messageId !== null &&
      '_serialized' in (messageId as object)
    ) {
      const serialized = (messageId as { _serialized?: unknown })._serialized;
      return typeof serialized === 'string' ? serialized : undefined;
    }

    return String(messageId);
  }

  private async simulateHumanTyping(
    jid: string,
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): Promise<void> {
    if (!jid) {
      return;
    }

    const client = this.getClient();

    let chat:
      | (Awaited<ReturnType<Client['getChatById']>> & {
          sendStateTyping?: () => Promise<unknown>;
          clearState?: () => Promise<unknown>;
        })
      | null = null;

    try {
      chat = await client.getChatById(jid);
    } catch {
      return;
    }

    if (!chat) {
      return;
    }

    const sendStateTyping =
      typeof chat.sendStateTyping === 'function'
        ? chat.sendStateTyping.bind(chat)
        : null;
    const clearState =
      typeof chat.clearState === 'function' ? chat.clearState.bind(chat) : null;

    if (!sendStateTyping || !clearState) {
      return;
    }

    const text = this.extractText(content, options);
    const durationMs = this.estimateTypingMs(text) * 0.5;

    const preThink = this.rand(100, 450);
    await this.sleep(preThink);

    const start = Date.now();
    try {
      await sendStateTyping();
    } catch {
      return;
    }

    while (Date.now() - start < durationMs) {
      const elapsed = Date.now() - start;
      const remaining = durationMs - elapsed;
      const baseTick = this.rand(600, 1200);
      const tick = Math.min(baseTick, remaining);

      await this.sleep(tick);

      if (Date.now() - start < durationMs) {
        try {
          if (this.rngFloat() < 0.12) {
            await clearState();
            const thinkPause = this.rand(250, 750);
            await this.sleep(thinkPause);
            await sendStateTyping();
          } else {
            await sendStateTyping();
          }
        } catch {
          break;
        }
      }
    }

    const windDown = this.rand(75, 250);
    await this.sleep(windDown);

    try {
      await clearState();
    } catch {}
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private rngFloat(): number {
    const cryptoApi = (globalThis as any).crypto ?? nodeCrypto;
    const arr = new Uint32Array(1);
    cryptoApi.getRandomValues(arr);
    return arr[0] / 0x100000000;
  }

  private rand(min: number, max: number): number {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(this.rngFloat() * (b - a + 1)) + a;
  }

  private countGraphemes(value: string): number {
    return Array.from(value ?? '').length;
  }

  private estimateTypingMs(text: string): number {
    const len = this.countGraphemes(text);

    if (!len) {
      return this.rand(300, 700);
    }

    const baseCps = this.rand(7, 12);
    const base = (len / baseCps) * 1000;

    const punctCount = (text.match(/[.,!?;:]/g) || []).length;
    const newlineCount = (text.match(/\n/g) || []).length;
    const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;

    const punctPause = punctCount * this.rand(80, 220);
    const newlinePause = newlineCount * this.rand(120, 320);
    const emojiPause = emojiCount * this.rand(70, 180);

    const jitter = base * (this.rand(-5, 12) / 100);
    const total = base + punctPause + newlinePause + emojiPause + jitter;

    const minMs = 500;
    return Math.round(Math.max(minMs, total));
  }

  private extractText(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): string {
    if (typeof content === 'string') {
      return content;
    }

    const caption = (options as { caption?: unknown } | undefined)?.caption;
    if (typeof caption === 'string') {
      return caption;
    }

    const textCandidate = (content as { text?: unknown } | undefined)?.text;
    if (typeof textCandidate === 'string') {
      return textCandidate;
    }

    return '';
  }

  private shouldSimulateTyping(
    content: Parameters<Client['sendMessage']>[1],
    options?: Parameters<Client['sendMessage']>[2]
  ): boolean {
    const parseVCards = (options as { parseVCards?: unknown } | undefined)
      ?.parseVCards;
    if (parseVCards === true) {
      return false;
    }

    if (typeof content === 'string') {
      const trimmed = content.trim().toUpperCase();
      if (trimmed.startsWith('BEGIN:VCARD') || trimmed.startsWith('MECARD:')) {
        return false;
      }

      return content.trim().length > 0;
    }

    const textCandidate = (content as { text?: unknown } | undefined)?.text;
    if (typeof textCandidate === 'string') {
      return textCandidate.trim().length > 0;
    }

    return false;
  }

  getOwnJid(): string {
    const client = this.getClient();
    const ownJidRaw = client.info?.wid?._serialized;

    if (!ownJidRaw) {
      throw new Error('Own JID not available');
    }

    const ownJid = normalizeJid(ownJidRaw);

    if (!ownJid) {
      throw new Error('Failed to normalize own JID');
    }

    return ownJid;
  }

  async resolveJid(raw: string): Promise<{ exists: boolean; jid?: string }> {
    const client = this.getClient();
    const normalizedRaw = this.normalizeSendJidCandidate(raw);
    if (!normalizedRaw) {
      return { exists: false };
    }

    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate?: string) => {
      if (!candidate) {
        return;
      }

      const normalizedCandidate = candidate.trim();
      if (!normalizedCandidate || seen.has(normalizedCandidate)) {
        return;
      }

      seen.add(normalizedCandidate);
      candidates.push(normalizedCandidate);
    };

    addCandidate(normalizedRaw);
    addCandidate(normalizeJid(normalizedRaw));

    const digits = onlyDigits(normalizedRaw);
    if (digits) {
      const numericCandidates = buildCandidates(digits, {
        order: 'input_first',
      });

      for (const numericCandidate of numericCandidates) {
        addCandidate(onlyDigits(numericCandidate));
      }
    }

    if (!candidates.length) {
      return { exists: false };
    }

    const onWhatsAppResults = await client.onWhatsApp(candidates);

    for (let i = 0; i < candidates.length; i++) {
      const item = onWhatsAppResults?.[i];
      const jid = item?.jid ? (normalizeJid(item.jid) ?? item.jid) : undefined;

      if (item?.exists && jid) {
        return { exists: true, jid };
      }
    }

    return { exists: false };
  }

  async updateProfileName(name: string): Promise<void> {
    const client = this.getClient();
    await client.setDisplayName(name);
  }

  async updateProfileStatus(status: string): Promise<void> {
    const client = this.getClient();
    await client.setStatus(status);
  }

  async removeProfilePicture(): Promise<void> {
    const client = this.getClient();
    await client.deleteProfilePicture();
  }

  async updateProfilePicture(photoUrl: string): Promise<void> {
    if (!MessageMedia?.fromUrl) {
      throw new Error('MessageMedia.fromUrl unavailable in wwebjs module');
    }

    const client = this.getClient();
    const media = await MessageMedia.fromUrl(photoUrl);
    await client.setProfilePicture(media);
  }

  addOwnJidToStatusList(statusJidList: string[]): string[] {
    try {
      const ownJid = this.getOwnJid();
      const normalizedStatusJidList = statusJidList.map(
        (jid) => normalizeJid(jid) ?? jid
      );
      const ownJidExists = normalizedStatusJidList.includes(ownJid);

      if (!ownJidExists) {
        return [...statusJidList, ownJid];
      }

      return statusJidList;
    } catch {
      return statusJidList;
    }
  }
}
