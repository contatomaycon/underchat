import { injectable, inject } from 'tsyringe';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { MessageMedia, type Client } from '@wwebjs/whatsapp-web.js';

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
