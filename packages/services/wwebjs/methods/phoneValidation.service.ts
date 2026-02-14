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

      if (numberId) {
        const jid =
          typeof numberId === 'object' &&
          numberId !== null &&
          '_serialized' in numberId
            ? (numberId as { _serialized: string })._serialized
            : undefined;
        const normalizedJid = jid ? normalizeJid(jid) : undefined;

        return {
          valid: true,
          jid: normalizedJid ?? jid,
          phone: getPhoneNumber(normalizedJid ?? jid) || candidate,
        };
      }
    }

    return { valid: false };
  }
}
