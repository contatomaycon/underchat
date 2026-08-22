import { singleton, inject } from 'tsyringe';
import makeWASocket from '@whiskeysockets/baileys';
import {
  type BaileysSessionLeaseLostListener,
  BaileysConnectionService,
  type BaileysConnectionStatusHealthEvidence,
} from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { BaileysPhoneValidationService } from './methods/phoneValidation.service';
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

  reconnect(input: IBaileysConnection): boolean {
    return this.connection.reconnect(input);
  }

  disconnect(input: IBaileysConnection): Promise<void> {
    return this.connection.disconnect(input);
  }

  isConnected(): boolean {
    return this.connection.connected;
  }

  hasCentralOnlineAcknowledgement(): boolean {
    return this.connection.hasCentralOnlineAcknowledgement();
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

  onSessionLeaseLost(listener: BaileysSessionLeaseLostListener): () => void {
    return this.connection.onSessionLeaseLost(listener);
  }

  beginSessionLeaseRecoveryResume(): number | undefined {
    return this.connection.beginSessionLeaseRecoveryResume();
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

  getConnectionStatusHealthEvidence(): BaileysConnectionStatusHealthEvidence {
    return this.connection.getConnectionStatusHealthEvidence();
  }

  getCode(): ECodeMessage {
    return this.connection.getCode();
  }

  hasSession(): boolean {
    return this.connection.hasSession();
  }

  refreshPersistedSessionState(): Promise<boolean> {
    return this.connection.refreshPersistedSessionState();
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

  get socket(): ReturnType<typeof makeWASocket> | undefined {
    return this.connection.getSocket();
  }

  sendPasskeyResponse(input: {
    worker_id?: string;
    account_id?: string;
    connection_attempt_id?: string;
    passkey_response: string;
    debug_trace_id?: string;
  }): Promise<IBaileysConnectionState> {
    return this.connection.sendPasskeyResponse(input);
  }

  confirmPasskey(input: {
    worker_id?: string;
    account_id?: string;
    connection_attempt_id?: string;
    debug_trace_id?: string;
  }): Promise<IBaileysConnectionState> {
    return this.connection.confirmPasskey(input);
  }

  importSecureSession(
    input: ISecureConnectionImportRequest
  ): Promise<IBaileysConnectionState> {
    return this.connection.importSecureSession(input);
  }

  clearUserRequestedDisconnect(): void {
    this.connection.clearUserRequestedDisconnect();
  }

  republishLastState(
    expectedConnectionAttemptId?: string
  ): IBaileysConnectionState | undefined {
    return this.connection.republishLastState(expectedConnectionAttemptId);
  }

  shutdown(): Promise<void> {
    return this.connection.shutdown();
  }

  suspend(): Promise<void> {
    return this.connection.suspend();
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
