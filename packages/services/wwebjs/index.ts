import { singleton, inject } from 'tsyringe';
import type { Client } from '@wwebjs/whatsapp-web.js';
import { WwebjsConnectionService } from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { WwebjsPhoneValidationService } from './methods/phoneValidation.service';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';

@singleton()
export class WwebjsService {
  constructor(
    @inject(WwebjsConnectionService)
    private readonly connection: WwebjsConnectionService,
    @inject(WwebjsPhoneValidationService)
    private readonly phoneValidationService: WwebjsPhoneValidationService
  ) {}

  connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    return this.connection.connect(input);
  }

  reconnect(input: IBaileysConnection): void {
    return this.connection.reconnect(input);
  }

  disconnect(input: IBaileysConnection): Promise<void> {
    return this.connection.disconnect(input);
  }

  isConnected(): boolean {
    return this.connection.connected;
  }

  getStatus(): EBaileysConnectionStatus {
    return this.connection.getStatus();
  }

  getCode(): ECodeMessage {
    return this.connection.getCode();
  }

  hasSession(): boolean {
    return this.connection.hasSession();
  }

  get socket(): Client | undefined {
    return this.connection.getSocket();
  }

  clearUserRequestedDisconnect(): void {
    this.connection.clearUserRequestedDisconnect();
  }

  cancelConnectionAttempt(): void {
    this.connection.cancelConnectionAttempt();
  }

  republishLastState(): void {
    this.connection.republishLastState();
  }

  shutdown(): Promise<void> {
    return this.connection.shutdown();
  }

  validatePhone(ddi: string, number: string): Promise<IPhoneValidationResult> {
    return this.phoneValidationService.validatePhone(ddi, number);
  }
}
