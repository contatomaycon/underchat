import { singleton, inject } from 'tsyringe';
import makeWASocket from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { BaileysPhoneValidationService } from './methods/phoneValidation.service';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';

@singleton()
export class BaileysService {
  constructor(
    @inject(BaileysConnectionService)
    private readonly connection: BaileysConnectionService,
    @inject(BaileysPhoneValidationService)
    private readonly phoneValidationService: BaileysPhoneValidationService
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

  get socket(): ReturnType<typeof makeWASocket> | undefined {
    return this.connection.getSocket();
  }

  clearUserRequestedDisconnect(): void {
    this.connection.clearUserRequestedDisconnect();
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
