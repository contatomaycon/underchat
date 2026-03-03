import { injectable, inject } from 'tsyringe';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

@injectable()
export class WwebjsPhoneValidationService {
  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService
  ) {}

  private async resolvePhoneFromLid(
    client: ReturnType<WwebjsConnectionService['getSocket']>,
    lidJid: string,
    fallback: string
  ): Promise<string> {
    const getContactById = (
      client as unknown as {
        getContactById?: (id: string) => Promise<{ number?: string } | null>;
      }
    ).getContactById;

    if (typeof getContactById !== 'function') return fallback;

    try {
      const contact = await getContactById.call(client, lidJid);
      return (contact?.number && onlyDigits(contact.number)) || fallback;
    } catch {
      return fallback;
    }
  }

  async validatePhone(
    ddi: string,
    number: string
  ): Promise<IPhoneValidationResult> {
    const client = this.connection.getSocket();
    if (!client) {
      throw new Error('Wwebjs client not connected');
    }

    const fullNumber = `${ddi}${number}`;
    const candidates = buildCandidates(fullNumber);

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const numberId = await client.getNumberId(onlyDigits(candidate));

      if (!numberId) continue;

      const jid =
        typeof numberId === 'object' &&
        numberId !== null &&
        '_serialized' in numberId
          ? (numberId as { _serialized: string })._serialized
          : undefined;
      const resolvedJid = (jid ? normalizeJid(jid) : undefined) ?? jid;

      let phone: string;
      if (resolvedJid?.endsWith('@lid')) {
        phone = await this.resolvePhoneFromLid(client, resolvedJid, candidate);
      } else {
        const phoneFromJid = getPhoneNumber(resolvedJid);
        phone =
          phoneFromJid && candidates.includes(phoneFromJid)
            ? phoneFromJid
            : candidate;
      }

      return { valid: true, jid: resolvedJid, phone };
    }

    return { valid: false };
  }
}
