import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WAMediaUpload,
  WASocket,
  generateMessageIDV2,
  generateWAMessageContent,
  generateWAMessageFromContent,
  proto,
} from '@whiskeysockets/baileys';
import { injectable, inject } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { webcrypto as nodeCrypto } from 'node:crypto';
import { BaileysDeliveryConfirmationService } from './deliveryConfirmation.service';
import { MessageDeliveryConfirmationFailedError } from '@core/common/exceptions/MessageDeliveryConfirmationFailedError';
import { TypingSimulationRuntimeService } from '@core/services/typingSimulationRuntime.service';
import { baileysEnvironment } from '@core/config/environments';
import { ITypingSimulationConfig } from '@core/common/interfaces/ITypingSimulationConfig';
import {
  defaultTypingSimulationConfig,
  typingSimulationDelayMultiplier,
} from '@core/common/functions/typingSimulationConfig';

@injectable()
export class BaileysHelpersService {
  private readonly SEND_CONFIRMATION_MAX_ATTEMPTS = 1;
  private readonly SEND_CONFIRMATION_TIMEOUT_MS = 20_000;

  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService,
    @inject(BaileysDeliveryConfirmationService)
    private readonly deliveryConfirmation: BaileysDeliveryConfirmationService,
    @inject(TypingSimulationRuntimeService)
    private readonly typingSimulationRuntimeService: TypingSimulationRuntimeService
  ) {}

  async send(
    address: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<WAMessage | undefined> {
    const sock = this.socket();
    this.assertSocketReadyForSend(sock);

    const shouldSimulateTyping = this.shouldSimulateTyping(content);
    const isEditMessage = this.isEditMessage(content);
    let jid = address;

    if (!address.includes('@')) {
      const resolved = await this.resolveJidFlexible(sock, address);
      if (!resolved.exists || !resolved.jid) {
        throw new Error(`Number not found on WhatsApp: ${address}`);
      }
      jid = resolved.jid;
    }

    if (shouldSimulateTyping) {
      const typingConfig = await this.getTypingSimulationConfig();
      if (typingConfig.enabled) {
        await this.simulateHumanTyping(jid, content, typingConfig.speed);
      }
    }

    const result = await this.sendOnce(sock, jid, content, options);
    const messageId = result?.key?.id;
    if (!messageId) {
      throw new Error(`Failed to send message to ${jid}: missing key.id`);
    }

    if (isEditMessage) {
      return result;
    }

    const outcome = await this.deliveryConfirmation.waitForOutcome(
      messageId,
      this.SEND_CONFIRMATION_TIMEOUT_MS
    );

    if (outcome === 'sent') {
      return result;
    }

    const lastOutcome = outcome === 'failed' ? 'failed' : 'timeout';
    const confirmationError =
      outcome === 'failed'
        ? new Error(`Message delivery failed acknowledgement for ${messageId}`)
        : new Error(`Message delivery confirmation timeout for ${messageId}`);

    throw new MessageDeliveryConfirmationFailedError({
      maxAttempts: this.SEND_CONFIRMATION_MAX_ATTEMPTS,
      lastMessageId: messageId,
      lastOutcome,
      cause: confirmationError,
    });
  }

  private async sendOnce(
    sock: WASocket,
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<WAMessage> {
    if (this.isAudioViewOnceMessage(content)) {
      const result = await this.sendAudioViewOnceMessage(
        sock,
        jid,
        content,
        options
      );

      if (!result) {
        throw new Error(
          `Failed to send message to ${jid}: result is undefined`
        );
      }

      return result;
    }

    const result = await sock.sendMessage(jid, content, options);

    if (!result) {
      throw new Error(`Failed to send message to ${jid}: result is undefined`);
    }

    return result;
  }

  private async getTypingSimulationConfig(): Promise<ITypingSimulationConfig> {
    try {
      return await this.typingSimulationRuntimeService.getConfig(
        baileysEnvironment.baileysWorkerId,
        baileysEnvironment.baileysAccountId
      );
    } catch (error) {
      console.error('[BaileysTypingSimulation] config unavailable', { error });

      return defaultTypingSimulationConfig();
    }
  }

  private async simulateHumanTyping(
    jid: string,
    content: AnyMessageContent,
    speed = 50
  ) {
    const sock = this.socket();
    if (!sock.user?.id) {
      return;
    }

    const text = this.extractText(content);
    const durationMs =
      this.estimateTypingMs(text) * typingSimulationDelayMultiplier(speed);

    const preThink = this.rand(100, 450);
    await this.sleep(preThink);

    const start = Date.now();
    await sock.sendPresenceUpdate('composing', jid);

    while (Date.now() - start < durationMs) {
      const elapsed = Date.now() - start;
      const remaining = durationMs - elapsed;

      const baseTick = this.rand(600, 1200);
      const tick = Math.min(baseTick, remaining);
      await this.sleep(tick);

      if (Date.now() - start < durationMs) {
        if (this.rngFloat() < 0.12) {
          await sock.sendPresenceUpdate('paused', jid);
          const thinkPause = this.rand(250, 750);
          await this.sleep(thinkPause);
          await sock.sendPresenceUpdate('composing', jid);
        } else {
          await sock.sendPresenceUpdate('composing', jid);
        }
      }
    }

    const windDown = this.rand(75, 250);
    await this.sleep(windDown);
    await sock.sendPresenceUpdate('paused', jid);
  }

  private socket(): WASocket {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }
    return s;
  }

  private isAudioViewOnceMessage(
    content: AnyMessageContent
  ): content is AnyMessageContent & {
    audio: WAMediaUpload;
    viewOnce: true;
  } {
    const maybeAudio = (content as { audio?: unknown }).audio;
    const maybeViewOnce = (content as { viewOnce?: unknown }).viewOnce;
    return !!maybeAudio && maybeViewOnce === true;
  }

  private async sendAudioViewOnceMessage(
    sock: WASocket,
    jid: string,
    content: AnyMessageContent & {
      audio: WAMediaUpload;
      viewOnce: true;
    },
    options?: MiscMessageGenerationOptions
  ): Promise<WAMessage> {
    const ownJid = sock.user?.id;
    if (!ownJid) {
      throw new Error(
        'Baileys connection unavailable: auth state is not ready'
      );
    }

    const rawSeconds = (content as { seconds?: unknown }).seconds;
    const seconds = this.toPositiveNumber(rawSeconds);
    const ptt = (content as { ptt?: unknown }).ptt === true;
    const waveform = this.toWaveform(
      ptt ? (content as { waveform?: unknown }).waveform : undefined
    );
    const mimetype = this.toNonEmptyString(
      (content as { mimetype?: unknown }).mimetype
    );
    const contextInfo = (content as { contextInfo?: proto.IContextInfo })
      .contextInfo;

    const mediaContent: AnyMessageContent = {
      audio: content.audio,
      ptt,
      seconds,
      waveform,
      mimetype,
      contextInfo,
    };

    const generatedMediaMessage = await generateWAMessageContent(mediaContent, {
      upload: sock.waUploadToServer,
      mediaUploadTimeoutMs: options?.mediaUploadTimeoutMs,
    });

    const audioMessageWithViewOnce = proto.Message.AudioMessage.fromObject({
      ...generatedMediaMessage.audioMessage,
      viewOnce: true,
    });

    const wrappedMessage = proto.Message.fromObject({
      viewOnceMessage: {
        message: proto.Message.fromObject({
          audioMessage: audioMessageWithViewOnce,
        }),
      },
      messageContextInfo: generatedMediaMessage.messageContextInfo,
    });

    const fullMessage = generateWAMessageFromContent(jid, wrappedMessage, {
      userJid: ownJid,
      messageId: options?.messageId ?? generateMessageIDV2(ownJid),
      timestamp: options?.timestamp,
      quoted: options?.quoted,
      ephemeralExpiration: options?.ephemeralExpiration,
    });

    if (!fullMessage.message) {
      throw new Error(
        'Failed to send view-once audio: message payload missing'
      );
    }

    await sock.relayMessage(jid, fullMessage.message, {
      messageId: fullMessage.key.id ?? undefined,
      useCachedGroupMetadata: options?.useCachedGroupMetadata,
      statusJidList: options?.statusJidList,
    });

    return fullMessage;
  }

  private toPositiveNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return undefined;
  }

  private toWaveform(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array && value.length > 0) {
      return value;
    }
    return undefined;
  }

  private toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private assertSocketReadyForSend(sock: WASocket): void {
    if (!this.connection.connected) {
      throw new Error(
        'Baileys connection unavailable: socket is not connected yet'
      );
    }

    const ownJid = sock.user?.id;
    if (!ownJid) {
      throw new Error(
        'Baileys connection unavailable: auth state is not ready yet'
      );
    }
  }

  private async resolveJidFlexible(sock: WASocket, raw: string) {
    const candidates = buildCandidates(raw, { order: 'input_first' });

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const resp = await sock.onWhatsApp(onlyDigits(candidate));
      const item = resp?.[0];
      const jid = item?.jid ? normalizeJid(item.jid) : undefined;

      if (item?.exists && jid) {
        return { exists: true as const, jid };
      }
    }

    return { exists: false as const, jid: undefined };
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private rngFloat() {
    const cryptoApi = (globalThis as any).crypto ?? nodeCrypto;
    const arr = new Uint32Array(1);
    cryptoApi.getRandomValues(arr);
    return arr[0] / 0x100000000;
  }

  private rand(min: number, max: number) {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(this.rngFloat() * (b - a + 1)) + a;
  }

  private countGraphemes(str: string) {
    return Array.from(str ?? '').length;
  }

  private isReactionOrEdit(content: AnyMessageContent): boolean {
    return !!(content as any)?.react || !!(content as any)?.edit;
  }

  private isEditMessage(content: AnyMessageContent): boolean {
    return !!(content as { edit?: unknown })?.edit;
  }

  private shouldSimulateTyping(content: AnyMessageContent): boolean {
    if (this.isReactionOrEdit(content)) {
      return false;
    }

    const text = (content as any)?.text;
    return typeof text === 'string' && text.trim().length > 0;
  }

  private extractText(content: AnyMessageContent) {
    if ((content as any)?.text) return String((content as any).text);
    if ((content as any)?.caption) return String((content as any).caption);
    if ((content as any)?.extendedTextMessage?.text)
      return String((content as any).extendedTextMessage.text);
    if ((content as any)?.react?.text)
      return String((content as any).react.text);
    return '';
  }

  private estimateTypingMs(text: string) {
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

  getOwnJid(): string {
    const sock = this.socket();
    const ownJidRaw = sock.user?.id;

    if (!ownJidRaw) {
      throw new Error('Own JID not available');
    }

    const ownJid = normalizeJid(ownJidRaw);

    if (!ownJid) {
      throw new Error('Failed to normalize own JID');
    }

    return ownJid;
  }

  async updateProfileName(name: string): Promise<void> {
    const sock = this.socket();
    await sock.updateProfileName(name);
  }

  async updateProfileStatus(status: string): Promise<void> {
    const sock = this.socket();
    await sock.updateProfileStatus(status);
  }

  async removeProfilePicture(jid: string): Promise<void> {
    const sock = this.socket();
    await sock.removeProfilePicture(jid);
  }

  async updateProfilePicture(photoUrl: string): Promise<void> {
    const sock = this.socket();
    const ownJid = this.getOwnJid();
    await sock.updateProfilePicture(ownJid, { url: photoUrl });
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
