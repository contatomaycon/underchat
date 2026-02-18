import { injectable, inject } from 'tsyringe';
import whatsappWeb, { type Client } from '@wwebjs/whatsapp-web.js';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { webcrypto as nodeCrypto } from 'node:crypto';

const { MessageMedia } = whatsappWeb;

@injectable()
export class WwebjsHelpersService {
  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService
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
    const client = this.getClient();
    if (this.shouldSimulateTyping(content, options)) {
      await this.simulateHumanTyping(jid, content, options);
    }
    const sendOptions = {
      ...(options ?? {}),
      waitUntilMsgSent: true,
    } as Parameters<Client['sendMessage']>[2];
    return client.sendMessage(jid, content, sendOptions);
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
    const candidates = buildCandidates(raw);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const numberId = await client.getNumberId(onlyDigits(candidate));

      if (numberId) {
        const jid =
          numberId._serialized ?? normalizeJid(numberId as unknown as string);
        return { exists: true, jid: jid ?? undefined };
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
