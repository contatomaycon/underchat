import { singleton } from 'tsyringe';
import makeWASocket from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { BaileysPhoneValidationService } from './methods/phoneValidation.service';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';

let qrCodeResetCallback: (() => void) | undefined;
let connectionEstablishedCallback: (() => void) | undefined;

export function setQrCodeResetCallback(callback: () => void): void {
  qrCodeResetCallback = callback;
}

export function setConnectionEstablishedCallback(callback: () => void): void {
  connectionEstablishedCallback = callback;
}

export function triggerConnectionEstablished(): void {
  if (connectionEstablishedCallback) {
    connectionEstablishedCallback();
  }
}

@singleton()
export class BaileysService {
  constructor(
    private readonly connection: BaileysConnectionService,
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

  resetQrCodeCounter(): void {
    if (qrCodeResetCallback) {
      qrCodeResetCallback();
    }
  }

  clearUserRequestedDisconnect(): void {
    this.connection.clearUserRequestedDisconnect();
  }

  republishLastState(): void {
    this.connection.republishLastState();
  }

  validatePhone(ddi: string, number: string): Promise<IPhoneValidationResult> {
    return this.phoneValidationService.validatePhone(ddi, number);
  }
}
