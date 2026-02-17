import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  WAMessage,
  WASocket,
} from '@whiskeysockets/baileys';
import { injectable, inject } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { webcrypto as nodeCrypto } from 'node:crypto';

@injectable()
export class BaileysHelpersService {
  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService
  ) {}

  async send(
    address: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<WAMessage | undefined> {
    const sock = this.socket();

    const shouldSimulateTyping = this.shouldSimulateTyping(content);

    if (address.includes('@')) {
      if (shouldSimulateTyping) {
        await this.simulateHumanTyping(address, content);
      }
      const result = await sock.sendMessage(address, content, options);

      if (!result) {
        throw new Error(
          `Failed to send message to ${address}: result is undefined`
        );
      }

      return result;
    }

    const { exists, jid } = await this.resolveJidFlexible(sock, address);
    if (!exists || !jid) {
      throw new Error(`Number not found on WhatsApp: ${address}`);
    }

    if (shouldSimulateTyping) {
      await this.simulateHumanTyping(jid, content);
    }

    const result = await sock.sendMessage(jid, content, options);

    if (!result) {
      throw new Error(`Failed to send message to ${jid}: result is undefined`);
    }

    return result;
  }

  private async simulateHumanTyping(jid: string, content: AnyMessageContent) {
    const sock = this.socket();
    if (!sock.user?.id) {
      return;
    }

    const text = this.extractText(content);
    const durationMs = this.estimateTypingMs(text) * 0.5;

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

  private async resolveJidFlexible(sock: WASocket, raw: string) {
    const candidates = buildCandidates(raw);
    const probes = await Promise.all(
      candidates.map(async (c) => {
        const resp = await sock.onWhatsApp(onlyDigits(c));
        const item = resp?.[0];
        return {
          candidate: c,
          exists: !!item?.exists,
          jid: item?.jid ? normalizeJid(item.jid) : undefined,
        };
      })
    );

    const found = probes.find((p) => p.exists && p.jid);
    if (found) return { exists: true as const, jid: found.jid };
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
