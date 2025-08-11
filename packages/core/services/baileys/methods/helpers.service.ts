import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { injectable } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { normalizeJid } from '@core/common/functions/normalizeJid';

@injectable()
export class BaileysHelpersService {
  constructor(private readonly connection: BaileysConnectionService) {
    if (!this.connection.connected) {
      this.connection.reconnect({ initial_connection: true });
    }
  }

  async send(
    address: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<proto.WebMessageInfo | undefined> {
    const sock = this.socket();

    if (address.includes('@')) {
      await this.simulateHumanTyping(address, content);

      return sock.sendMessage(address, content, options);
    }

    const { exists, jid } = await this.resolveJidFlexible(sock, address);
    if (!exists || !jid) {
      throw new Error(`Number not found on WhatsApp: ${address}`);
    }

    await this.simulateHumanTyping(jid, content);

    return sock.sendMessage(jid, content, options);
  }

  private async simulateHumanTyping(jid: string, content: AnyMessageContent) {
    const sock = this.socket();
    const text = this.extractText(content);
    const durationMs = this.estimateTypingMs(text);

    const preThink = this.rand(300, 1200);
    await this.sleep(preThink);

    const start = Date.now();
    await sock.sendPresenceUpdate('composing', jid);

    while (Date.now() - start < durationMs) {
      const remaining = durationMs - (Date.now() - start);
      const tick = Math.min(5000, remaining);

      await this.sleep(tick);
      if (Date.now() - start < durationMs) {
        await sock.sendPresenceUpdate('composing', jid);
      }
    }

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

  private rand(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private countGraphemes(str: string) {
    return Array.from(str ?? '').length;
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
    const baseCps = this.rand(3, 6);
    const base = (len / baseCps) * 1000;

    const punctCount = (text.match(/[.,!?;:]/g) || []).length;
    const newlineCount = (text.match(/\n/g) || []).length;

    const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;

    const punctPause = punctCount * this.rand(200, 500);
    const newlinePause = newlineCount * this.rand(400, 900);
    const emojiPause = emojiCount * this.rand(150, 350);

    const jitter = base * (this.rand(-10, 15) / 100);

    const total = base + punctPause + newlinePause + emojiPause + jitter;

    const minMs = 800;
    const maxMs = 25000;
    const clamped = Math.max(minMs, Math.min(total, maxMs));

    return Math.round(clamped);
  }
}
