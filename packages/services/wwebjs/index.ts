import { singleton, inject } from 'tsyringe';
import type { Client } from '@wwebjs/whatsapp-web.js';
import {
  WwebjsConnectionService,
  type WwebjsConnectionStatusHealthEvidence,
  type WwebjsSessionLeaseLostListener,
} from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { WwebjsPhoneValidationService } from './methods/phoneValidation.service';
import { IPhoneValidationResult } from '@core/common/interfaces/IPhoneValidationResult';
import {
  IPrepareProviderHandoffRequestProto,
  IPrepareProviderHandoffResponseProto,
} from '@core/common/interfaces/IProviderHandoffPrepareProto';
import { IWhatsappConnectionStatus } from '@core/common/interfaces/IWhatsappConnectionStatus';
import type {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';

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

  getConnectionStatus(): IWhatsappConnectionStatus | undefined {
    return this.connection.getConnectionStatus();
  }

  onConnectionStatus(
    listener: (snapshot: IWhatsappConnectionStatus) => void
  ): () => void {
    return this.connection.onConnectionStatus(listener);
  }

  onSessionLeaseLost(listener: WwebjsSessionLeaseLostListener): () => void {
    return this.connection.onSessionLeaseLost(listener);
  }

  beginSessionLeaseRecoveryResume(): number | undefined {
    return this.connection.beginSessionLeaseRecoveryResume();
  }

  startSessionLeaseRecoverySocket(generation?: number): boolean {
    return this.connection.startSessionLeaseRecoverySocket(generation);
  }

  markSessionLeaseRecoveryCompleted(generation?: number): boolean {
    return this.connection.markSessionLeaseRecoveryCompleted(generation);
  }

  abortSessionLeaseRecoveryResume(generation?: number): void {
    this.connection.abortSessionLeaseRecoveryResume(generation);
  }

  getConnectionStatusSourceId(): string | undefined {
    return this.connection.getConnectionStatusSourceId();
  }

  getConnectionStatusHealthEvidence(): WwebjsConnectionStatusHealthEvidence {
    return this.connection.getConnectionStatusHealthEvidence();
  }

  getCode(): ECodeMessage {
    return this.connection.getCode();
  }

  hasSession(): boolean {
    return this.connection.hasSession();
  }

  canRecoverRestorableSession(): boolean {
    return this.connection.canRecoverRestorableSession();
  }

  ensureRestorableSessionRecovery(source: string): boolean {
    return this.connection.ensureRestorableSessionRecovery(source);
  }

  verifyAndPublishConnectionStatus(
    input: Pick<
      IBaileysConnectionState,
      | 'connection_attempt_id'
      | 'authorized_connection_epoch'
      | 'debug_trace_id'
      | 'runtime_generation'
    > = {}
  ): Promise<IBaileysConnectionState> {
    return this.connection.verifyAndPublishConnectionStatus(input);
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

  importSecureSession(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    return this.connection.importSecureSession(input);
  }

  shutdown(): Promise<void> {
    return this.connection.shutdown();
  }

  prepareProviderHandoff(
    input: IPrepareProviderHandoffRequestProto
  ): Promise<IPrepareProviderHandoffResponseProto> {
    return this.connection.prepareProviderHandoff(input);
  }

  prepareSessionStorageMigration(
    input: IPrepareSessionStorageMigrationRequestProto
  ): Promise<IPrepareSessionStorageMigrationResponseProto> {
    return this.connection.prepareSessionStorageMigration(input);
  }

  validatePhone(ddi: string, number: string): Promise<IPhoneValidationResult> {
    return this.phoneValidationService.validatePhone(ddi, number);
  }
}
