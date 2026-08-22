import { injectable, inject } from 'tsyringe';
import { WwebjsConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import type { Client } from '@wwebjs/whatsapp-web.js';
import {
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  isProviderAuxiliaryInvocationFenceError,
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';

@injectable()
export class WwebjsPhoneValidationService {
  private static readonly LID_PHONE_RESOLUTION_MAX_ATTEMPTS = 3;

  private static readonly LID_PHONE_RESOLUTION_RETRY_DELAY_MS = 120;

  private readonly providerInvocationSingleFlight =
    new ProviderInvocationSingleFlight();
  private readonly AUXILIARY_PROVIDER_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();

  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService
  ) {}

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async invokeOnWhatsApp<T>(
    client: Client,
    operation: string,
    invoke: () => Promise<T>
  ): Promise<T> {
    const providerLease = this.providerInvocationSingleFlight.acquire(client);
    if (!providerLease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(client);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(client);
      }
      throw new ProviderInvocationInFlightError(
        stalled ? 'stalled' : 'capacity'
      );
    }
    let failureReported = false;
    const providerCall = providerLease.start(invoke);
    void providerCall.catch((error: unknown) => {
      if (!failureReported) {
        failureReported = true;
        if (
          this.connection.reportOutboundSendFailure?.(client, error) === true
        ) {
          providerLease.markStalled();
        }
      }
    });

    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'wwebjs',
        operation,
        timeoutMs: this.AUXILIARY_PROVIDER_TIMEOUT_MS,
        invoke: () => providerCall,
      });
    } catch (error) {
      if (error instanceof ProviderAuxiliaryInvocationTimeoutError) {
        providerLease.markStalled();
        if (!failureReported) {
          failureReported = true;
          const recoveryStarted = this.connection.reportOutboundSendFailure?.(
            client,
            error,
            {
              timedOut: true,
            }
          );
          if (recoveryStarted !== true) {
            this.connection.ensureOutboundSendRecovery?.(client);
          }
        } else {
          this.connection.ensureOutboundSendRecovery?.(client);
        }
      }
      throw error;
    }
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
    const onWhatsApp = (
      client as unknown as {
        onWhatsApp?: (
          input: string[]
        ) => Promise<Array<{ jid: string | null; exists: boolean }>>;
      }
    ).onWhatsApp;

    if (typeof onWhatsApp !== 'function') return undefined;

    try {
      const [result] = await this.invokeOnWhatsApp(
        client as Client,
        'resolve_phone_from_lid',
        () => onWhatsApp.call(client, [lidJid])
      );
      const resolvedJid = result?.jid
        ? (normalizeJid(result.jid) ?? result.jid)
        : undefined;

      if (!result?.exists || !resolvedJid || resolvedJid.endsWith('@lid')) {
        return undefined;
      }

      return this.normalizePhoneDigits(resolvedJid.split('@')[0]);
    } catch (error) {
      if (isProviderAuxiliaryInvocationFenceError(error)) {
        throw error;
      }
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

    let deferredLidFallback:
      { jid: string | undefined; phone: string } | undefined;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const [onWhatsAppResult] = await this.invokeOnWhatsApp(
        client,
        'validate_phone',
        () => client.onWhatsApp([onlyDigits(candidate)])
      );
      const resolvedJid = onWhatsAppResult?.jid
        ? (normalizeJid(onWhatsAppResult.jid) ?? onWhatsAppResult.jid)
        : undefined;

      if (!onWhatsAppResult?.exists || !resolvedJid) {
        continue;
      }

      if (resolvedJid?.endsWith('@lid')) {
        const lidResolution = await this.resolveReliablePhoneFromLidWithRetry(
          client,
          resolvedJid,
          candidates
        );
        const resolvedPhoneFromLid = lidResolution.phone;

        if (resolvedPhoneFromLid) {
          return { valid: true, jid: resolvedJid, phone: resolvedPhoneFromLid };
        }

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
        return { valid: true, jid: resolvedJid, phone: phoneFromJid };
      }

      return { valid: true, jid: resolvedJid, phone: candidate };
    }

    if (deferredLidFallback) {
      return {
        valid: true,
        jid: deferredLidFallback.jid,
        phone: deferredLidFallback.phone,
      };
    }

    return { valid: false };
  }
}
