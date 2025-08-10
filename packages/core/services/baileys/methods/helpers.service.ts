import {
  AnyMessageContent,
  jidNormalizedUser,
  MiscMessageGenerationOptions,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { injectable } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysHelpersService {
  constructor(private readonly connection: BaileysConnectionService) {
    if (!this.connection.connected) {
      this.connection.reconnect({ initial_connection: true });
    }
  }

  toJid(raw: string) {
    const n = this.onlyDigits(raw);

    return jidNormalizedUser(`${n}@s.whatsapp.net`);
  }

  async send(
    phone: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<proto.WebMessageInfo | undefined> {
    const sock = this.socket();
    const { exists, jid } = await this.resolveJidFlexible(sock, phone);

    if (!exists || !jid) {
      throw new Error(`Number not found on WhatsApp: ${phone}`);
    }

    return sock.sendMessage(jid, content, options);
  }

  private socket(): WASocket {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }

    return s;
  }

  private onlyDigits(v: string) {
    return v.replace(/\D/g, '');
  }

  private isBrazil(numeric: string) {
    return numeric.startsWith('55');
  }

  private buildCandidatesBR(numeric: string) {
    const n = this.onlyDigits(numeric);
    const rest = n.slice(2);
    if (rest.length < 10) return [n];

    const ddd = rest.slice(0, 2);
    const local = rest.slice(2);

    const with9 = `55${ddd}${local.startsWith('9') ? local : '9' + local}`;
    const without9 = `55${ddd}${local.startsWith('9') ? local.slice(1) : local}`;

    return Array.from(new Set([with9, without9]));
  }

  private buildCandidates(numeric: string) {
    const n = this.onlyDigits(numeric);
    if (!this.isBrazil(n)) return [n];

    return this.buildCandidatesBR(n);
  }

  private async resolveJidFlexible(sock: WASocket, raw: string) {
    const candidates = this.buildCandidates(raw);
    const probes = await Promise.all(
      candidates.map(async (c) => {
        const resp = await sock.onWhatsApp(this.onlyDigits(c));
        const item = resp?.[0];

        return {
          candidate: c,
          exists: !!item?.exists,
          jid: item?.jid ? jidNormalizedUser(item.jid) : undefined,
        };
      })
    );

    const found = probes.find((p) => p.exists && p.jid);
    if (found) return { exists: true as const, jid: found.jid };

    return { exists: false as const, jid: undefined };
  }
}
