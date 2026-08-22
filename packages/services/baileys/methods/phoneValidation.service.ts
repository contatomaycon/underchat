import { injectable, inject } from 'tsyringe';
import { BaileysConnectionService } from './connection.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizeJid } from '@core/common/functions/normalizeJid';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';
import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';
import type { WASocket } from '@whiskeysockets/baileys';
import {
  ProviderInvocationInFlightError,
  ProviderInvocationSingleFlight,
} from '@core/common/functions/providerInvocationSingleFlight';
import {
  invokeProviderAuxiliaryWithTimeout,
  ProviderAuxiliaryInvocationTimeoutError,
  resolveProviderAuxiliaryTimeoutMs,
} from '@core/common/functions/providerAuxiliaryInvocation';

@injectable()
export class BaileysPhoneValidationService {
  private readonly providerInvocationSingleFlight =
    new ProviderInvocationSingleFlight();
  private readonly AUXILIARY_PROVIDER_TIMEOUT_MS =
    resolveProviderAuxiliaryTimeoutMs();

  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService
  ) {}

  private async invokeOnWhatsApp<T>(
    socket: WASocket,
    operation: string,
    invoke: () => Promise<T>
  ): Promise<T> {
    const providerLease = this.providerInvocationSingleFlight.acquire(socket);
    if (!providerLease) {
      const stalled = this.providerInvocationSingleFlight.isStalled(socket);
      if (stalled) {
        this.connection.ensureOutboundSendRecovery?.(socket);
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
          this.connection.reportOutboundSendFailure?.(socket, error) === true
        ) {
          providerLease.markStalled();
        }
      }
    });

    try {
      return await invokeProviderAuxiliaryWithTimeout({
        provider: 'baileys',
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
            socket,
            error,
            {
              timedOut: true,
            }
          );
          if (recoveryStarted !== true) {
            this.connection.ensureOutboundSendRecovery?.(socket);
          }
        } else {
          this.connection.ensureOutboundSendRecovery?.(socket);
        }
      }
      throw error;
    }
  }

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
      const resp = await this.invokeOnWhatsApp(socket, 'validate_phone', () =>
        socket.onWhatsApp(onlyDigits(candidate))
      );
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
