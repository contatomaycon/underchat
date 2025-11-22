import { injectable } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

@injectable()
export class BaileysPhoneValidationService {
  constructor(private readonly connection: BaileysConnectionService) {}

  async validatePhone(
    ddi: string,
    number: string
  ): Promise<IPhoneValidationResult> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error('Baileys socket not connected');
    }
    const fullNumber = `${ddi}${number}`;
    const candidates = buildCandidates(fullNumber);

    const validationPromises = candidates.map(async (candidate) => {
      const resp = await socket.onWhatsApp(onlyDigits(candidate));
      const item = resp?.[0];
      return {
        candidate,
        exists: !!item?.exists,
        jid: item?.jid ? normalizeJid(item.jid) : undefined,
      };
    });

    const result = await validationPromises.reduce(
      async (previousPromise, currentPromise) => {
        const previousResult = await previousPromise;

        if (previousResult.valid) {
          return previousResult;
        }

        const currentResult = await currentPromise;

        if (currentResult.exists && currentResult.jid) {
          return {
            valid: true,
            jid: currentResult.jid,
            phone: currentResult.candidate,
          };
        }

        return { valid: false };
      },
      Promise.resolve({ valid: false } as IPhoneValidationResult)
    );

    return result;
  }
}
