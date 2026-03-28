import { injectable, inject } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

@injectable()
export class BaileysPhoneValidationService {
  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService
  ) {}

  async validatePhone(
    ddi: string,
    number: string
  ): Promise<IPhoneValidationResult> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error('Baileys socket not connected');
    }
    const fullNumber = `${ddi}${number}`;
    const candidates = buildCandidates(fullNumber, { order: 'input_first' });

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const resp = await socket.onWhatsApp(onlyDigits(candidate));
      const item = resp?.[0];
      const jid = item?.jid ? normalizeJid(item.jid) : undefined;

      if (item?.exists && jid) {
        return {
          valid: true,
          jid,
          phone: getPhoneNumber(jid) || candidate,
        };
      }
    }

    return { valid: false };
  }
}
