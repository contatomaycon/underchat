import { singleton } from 'tsyringe';
import makeWASocket from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { BaileysPhoneValidationService } from './methods/phoneValidation.service';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';

@singleton()
export class BaileysService {
  constructor(
    private readonly connection: BaileysConnectionService,
    private readonly phoneValidationService: BaileysPhoneValidationService
  ) {}

  connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    console.log('[worker_baileys:service] BaileysService.connect', {
      input,
      ts: Date.now(),
    });
    return this.connection.connect(input);
  }

  reconnect(input: IBaileysConnection): void {
    console.log('[worker_baileys:service] BaileysService.reconnect', {
      input,
      ts: Date.now(),
    });
    return this.connection.reconnect(input);
  }

  disconnect(input: IBaileysConnection): Promise<void> {
    console.log('[worker_baileys:service] BaileysService.disconnect', {
      input,
      ts: Date.now(),
    });
    return this.connection.disconnect(input);
  }

  abortConnectionAttempt(reason?: string): void {
    console.log(
      '[worker_baileys:service] BaileysService.abortConnectionAttempt',
      {
        reason,
        ts: Date.now(),
      }
    );
    return this.connection.abortConnectionAttempt(reason);
  }

  isConnected(): boolean {
    return this.connection.connected;
  }

  getStatus(): EBaileysConnectionStatus {
    return this.connection.getStatus();
  }

  hasSession(): boolean {
    return this.connection.hasSession();
  }

  get socket(): ReturnType<typeof makeWASocket> | undefined {
    return this.connection.getSocket();
  }

  validatePhone(ddi: string, number: string): Promise<IPhoneValidationResult> {
    return this.phoneValidationService.validatePhone(ddi, number);
  }
}
