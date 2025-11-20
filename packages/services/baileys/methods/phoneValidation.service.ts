import { injectable } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';

@injectable()
export class BaileysPhoneValidationService {
  constructor(private readonly connection: BaileysConnectionService) {}

  private buildCandidates(ddi: string, number: string): string[] {
    const normalizedDdi = onlyDigits(ddi);
    const normalizedNumber = onlyDigits(number);

    if (normalizedDdi === '55') {
      const fullNumber = `${normalizedDdi}${normalizedNumber}`;

      const rest = fullNumber.slice(2);
      if (rest.length < 10) return [fullNumber];

      const ddd = rest.slice(0, 2);
      const local = rest.slice(2);

      const without9Local =
        local.length === 9 && local.startsWith('9') ? local.slice(1) : local;

      const with9Local = local.length === 8 ? `9${local}` : local;

      const without9 = `55${ddd}${without9Local}`;
      const with9 = `55${ddd}${with9Local}`;

      const candidates = [without9, with9];
      return Array.from(new Set(candidates));
    }

    return [`${normalizedDdi}${normalizedNumber}`];
  }

  async validatePhone(
    ddi: string,
    number: string
  ): Promise<IPhoneValidationResult> {
    const socket = this.connection.getSocket();
    if (!socket) {
      throw new Error('Baileys socket not connected');
    }

    const candidates = this.buildCandidates(ddi, number);

    const validationPromises = candidates.map((candidate) => {
      return socket.onWhatsApp(onlyDigits(candidate)).then((resp) => {
        const item = resp?.[0];
        return {
          candidate,
          exists: !!item?.exists,
          jid: item?.jid ? normalizeJid(item.jid) : undefined,
        };
      });
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
