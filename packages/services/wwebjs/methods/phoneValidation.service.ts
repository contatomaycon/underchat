import { injectable, inject } from 'tsyringe';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

@injectable()
export class WwebjsPhoneValidationService {
  private static readonly LID_PHONE_RESOLUTION_MAX_ATTEMPTS = 3;

  private static readonly LID_PHONE_RESOLUTION_RETRY_DELAY_MS = 120;

  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService
  ) {}

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizePhoneDigits(
    value: string | null | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const digits = onlyDigits(value);
    return digits || undefined;
  }

  private isResolvedPhoneEquivalentToLid(
    lidJid: string,
    resolvedPhone: string
  ): boolean {
    const lidDigits = this.normalizePhoneDigits(lidJid.split('@')[0]);
    const resolvedDigits = this.normalizePhoneDigits(resolvedPhone);

    return !!lidDigits && !!resolvedDigits && lidDigits === resolvedDigits;
  }

  private isResolvedPhoneFromLidReliable(
    lidJid: string,
    resolvedPhone: string,
    candidates: string[]
  ): boolean {
    const resolvedDigits = this.normalizePhoneDigits(resolvedPhone);
    if (!resolvedDigits) {
      return false;
    }

    if (this.isResolvedPhoneEquivalentToLid(lidJid, resolvedDigits)) {
      return false;
    }

    return candidates.includes(resolvedDigits);
  }

  private getLidDiscardReason(
    lidJid: string,
    resolvedPhone: string | undefined,
    candidates: string[]
  ): 'not_found' | 'lid_equivalent' | 'candidate_mismatch' {
    if (!resolvedPhone) {
      return 'not_found';
    }

    if (this.isResolvedPhoneEquivalentToLid(lidJid, resolvedPhone)) {
      return 'lid_equivalent';
    }

    const resolvedDigits = this.normalizePhoneDigits(resolvedPhone);
    if (!resolvedDigits || !candidates.includes(resolvedDigits)) {
      return 'candidate_mismatch';
    }

    return 'not_found';
  }

  private async resolvePhoneFromLid(
    client: ReturnType<WwebjsConnectionService['getSocket']>,
    lidJid: string
  ): Promise<string | undefined> {
    const getContactById = (
      client as unknown as {
        getContactById?: (id: string) => Promise<{ number?: string } | null>;
      }
    ).getContactById;

    if (typeof getContactById !== 'function') return undefined;

    try {
      const contact = await getContactById.call(client, lidJid);
      return this.normalizePhoneDigits(contact?.number);
    } catch {
      return undefined;
    }
  }

  private async resolveReliablePhoneFromLidWithRetry(
    client: ReturnType<WwebjsConnectionService['getSocket']>,
    lidJid: string,
    candidates: string[]
  ): Promise<{ phone?: string; attempts: number; lastResolvedPhone?: string }> {
    let lastResolvedPhone: string | undefined;

    for (
      let attempt = 1;
      attempt <= WwebjsPhoneValidationService.LID_PHONE_RESOLUTION_MAX_ATTEMPTS;
      attempt++
    ) {
      const resolvedPhoneFromLid = await this.resolvePhoneFromLid(
        client,
        lidJid
      );
      lastResolvedPhone = resolvedPhoneFromLid;

      if (
        resolvedPhoneFromLid &&
        this.isResolvedPhoneFromLidReliable(
          lidJid,
          resolvedPhoneFromLid,
          candidates
        )
      ) {
        return {
          phone: resolvedPhoneFromLid,
          attempts: attempt,
          lastResolvedPhone: resolvedPhoneFromLid,
        };
      }

      if (
        attempt < WwebjsPhoneValidationService.LID_PHONE_RESOLUTION_MAX_ATTEMPTS
      ) {
        await this.sleep(
          WwebjsPhoneValidationService.LID_PHONE_RESOLUTION_RETRY_DELAY_MS
        );
      }
    }

    return {
      attempts: WwebjsPhoneValidationService.LID_PHONE_RESOLUTION_MAX_ATTEMPTS,
      lastResolvedPhone,
    };
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
    const candidates = buildCandidates(fullNumber, { order: 'input_first' });
    console.info('[WwebjsPhoneValidation] validation_start', {
      ddi,
      number,
      full_number: fullNumber,
      candidates,
    });

    let deferredLidFallback:
      | { jid: string | undefined; phone: string }
      | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.info('[WwebjsPhoneValidation] candidate_try', {
        candidate_index: i,
        candidate,
      });

      const numberId = await client.getNumberId(onlyDigits(candidate));

      if (!numberId) {
        console.info('[WwebjsPhoneValidation] candidate_not_found', {
          candidate_index: i,
          candidate,
        });
        continue;
      }

      const jid =
        typeof numberId === 'object' &&
        numberId !== null &&
        '_serialized' in numberId
          ? (numberId as { _serialized: string })._serialized
          : undefined;
      const resolvedJid = (jid ? normalizeJid(jid) : undefined) ?? jid;
      console.info('[WwebjsPhoneValidation] candidate_found', {
        candidate_index: i,
        candidate,
        jid: resolvedJid ?? null,
      });

      if (resolvedJid?.endsWith('@lid')) {
        const lidResolution = await this.resolveReliablePhoneFromLidWithRetry(
          client,
          resolvedJid,
          candidates
        );
        const resolvedPhoneFromLid = lidResolution.phone;

        if (resolvedPhoneFromLid) {
          console.info('[WwebjsPhoneValidation] lid_phone_resolved', {
            candidate_index: i,
            candidate,
            jid: resolvedJid,
            resolved_phone: resolvedPhoneFromLid,
            attempts: lidResolution.attempts,
          });
          return { valid: true, jid: resolvedJid, phone: resolvedPhoneFromLid };
        }

        console.warn('[WwebjsPhoneValidation] lid_phone_discarded', {
          lid_jid: resolvedJid,
          resolved_phone: lidResolution.lastResolvedPhone ?? null,
          fallback_candidate: candidate,
          reason: this.getLidDiscardReason(
            resolvedJid,
            lidResolution.lastResolvedPhone,
            candidates
          ),
          attempts: lidResolution.attempts,
        });

        if (!deferredLidFallback) {
          deferredLidFallback = {
            jid: resolvedJid,
            phone: candidate,
          };
        }

        continue;
      }

      const phoneFromJid = getPhoneNumber(resolvedJid);
      if (phoneFromJid) {
        console.info('[WwebjsPhoneValidation] candidate_success_by_jid', {
          candidate_index: i,
          candidate,
          jid: resolvedJid ?? null,
          phone_from_jid: phoneFromJid,
        });
        return { valid: true, jid: resolvedJid, phone: phoneFromJid };
      }

      console.info('[WwebjsPhoneValidation] candidate_success_by_input', {
        candidate_index: i,
        candidate,
        jid: resolvedJid ?? null,
      });
      return { valid: true, jid: resolvedJid, phone: candidate };
    }

    if (deferredLidFallback) {
      console.info('[WwebjsPhoneValidation] deferred_lid_fallback_applied', {
        jid: deferredLidFallback.jid ?? null,
        phone: deferredLidFallback.phone,
      });
      return {
        valid: true,
        jid: deferredLidFallback.jid,
        phone: deferredLidFallback.phone,
      };
    }

    console.info('[WwebjsPhoneValidation] validation_invalid', {
      ddi,
      number,
      full_number: fullNumber,
      candidates,
    });
    return { valid: false };
  }
}
