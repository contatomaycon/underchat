import { createHash, randomBytes } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import {
  ISecureConnectionImportRequest,
  ISecureConnectionSession,
  ISecureConnectionSessionPackage,
  SecureConnectionStatus,
  SecureConnectionTargetProvider,
  SECURE_CONNECTION_STATUSES,
} from '@core/common/interfaces/ISecureConnectionSession';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerBaileysGrpcClientService } from '@core/services/workerBaileysGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

const SECURE_HELPER_PROTOCOL = 'underchat-passkey';
const SECURE_HELPER_HOST = 'secure';
const SESSION_TTL_SECONDS = Math.max(
  300,
  Number(process.env.SECURE_CONNECTION_SESSION_TTL_SECONDS) || 900
);
const PAYLOAD_TTL_SECONDS = Math.max(
  SESSION_TTL_SECONDS,
  Number(process.env.SECURE_CONNECTION_PAYLOAD_TTL_SECONDS) || 1800
);

const SECURE_CONNECTION_STATUSES_SET = new Set<string>(
  SECURE_CONNECTION_STATUSES
);

const SECURE_CONNECTION_HELPER_STATUSES_SET = new Set<string>([
  'helper_opened',
  'wa_authenticated',
  'uploading',
  'failed',
]);

const SECURE_CONNECTION_ALLOWED_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.creating,
  EWorkerStatus.recreating,
]);

@injectable()
export class WorkerSecureConnectionSessionUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject('Redis') private readonly redis: Redis,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerBaileysGrpcClientService)
    private readonly workerBaileysGrpcClientService: WorkerBaileysGrpcClientService,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never
  ) {}

  async create(
    t: TFunction<'translation', undefined>,
    input: {
      accountId: string;
      workerId: string;
      apiBaseUrl: string;
      debugTraceId?: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const worker = await this.resolveWorker(t, input.accountId, input.workerId);
    const workerTypeId = worker.type?.id as EWorkerType | undefined;
    const workerStatusId = worker.status?.id;

    if (!workerTypeId || !this.isSupportedWorkerType(workerTypeId)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (
      workerStatusId &&
      !SECURE_CONNECTION_ALLOWED_WORKER_STATUSES.has(workerStatusId)
    ) {
      throw new Error(t('worker_qrcode_not_ready'));
    }

    const token = this.createToken();
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
    const runtime = await this.workerRuntimeRepository
      .viewByWorkerId(input.workerId)
      .catch(() => null);
    const session: ISecureConnectionSession = {
      account_id: input.accountId,
      worker_id: input.workerId,
      worker_type_id: workerTypeId,
      worker_status_id: workerStatusId,
      token,
      token_hash: tokenHash,
      deep_link: this.buildDeepLink(token, input.apiBaseUrl),
      status: 'created',
      connection_attempt_id: uuidv7(),
      runtime_generation: runtime?.runtime_generation ?? undefined,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    await this.saveSession(session);
    await this.redis.set(
      this.activeSessionKey(input.workerId, workerTypeId),
      token,
      'EX',
      SESSION_TTL_SECONDS
    );
    await this.publishStatus(session);

    this.logFlow('manager.secure_connection.created', session, {
      helper_protocol: SECURE_HELPER_PROTOCOL,
    });

    return this.toResponse(session, { includeToken: true });
  }

  async viewAuthenticated(
    t: TFunction<'translation', undefined>,
    input: {
      accountId: string;
      workerId: string;
      token: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const session = await this.getSessionOrThrow(t, input.token);
    this.assertSameWorker(t, session, input.accountId, input.workerId);

    return this.toResponse(session, { includeToken: true });
  }

  async cancelAuthenticated(
    t: TFunction<'translation', undefined>,
    input: {
      accountId: string;
      workerId: string;
      token: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const session = await this.getSessionOrThrow(t, input.token);
    this.assertSameWorker(t, session, input.accountId, input.workerId);

    const cancelled = await this.updateSession(session, {
      status: 'cancelled',
      fail_reason: 'cancelled_by_user',
    });
    await this.publishStatus(cancelled);

    return this.toResponse(cancelled, { includeToken: true });
  }

  async viewForHelper(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const session = await this.getSessionOrThrow(t, token);

    if (session.status === 'created') {
      const opened = await this.updateSession(session, {
        status: 'helper_opened',
      });
      await this.publishStatus(opened);
      return this.toResponse(opened);
    }

    return this.toResponse(session);
  }

  async updateHelperStatus(
    t: TFunction<'translation', undefined>,
    input: {
      token: string;
      status: string;
      helperVersion?: string;
      helperPlatform?: string;
      message?: string;
      error?: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const session = await this.getSessionOrThrow(t, input.token);
    if (this.isTerminalStatus(session.status)) {
      return this.toResponse(session);
    }

    const nextStatus = this.normalizeStatus(t, input.status);
    if (!SECURE_CONNECTION_HELPER_STATUSES_SET.has(nextStatus)) {
      throw new Error(t('worker_secure_connection_status_invalid'));
    }

    const next = await this.updateSession(session, {
      status: nextStatus,
      helper_version: input.helperVersion,
      helper_platform: input.helperPlatform,
      error: input.error,
      fail_reason: input.error ? 'helper_error' : session.fail_reason,
    });

    await this.publishStatus(next, { message: input.message });

    return this.toResponse(next);
  }

  async receiveSessionPackage(
    t: TFunction<'translation', undefined>,
    input: {
      token: string;
      package: ISecureConnectionSessionPackage;
      debugTraceId?: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    const session = await this.getSessionOrThrow(t, input.token);

    if (this.isTerminalStatus(session.status)) {
      throw new Error(t('worker_secure_connection_status_invalid'));
    }

    if (session.upload_received_at) {
      throw new Error(t('worker_secure_connection_session_already_uploaded'));
    }

    this.validateSessionPackage(t, session, input.package);

    const payloadRef = await this.storePayload(input.token, input.package);
    const received = await this.updateSession(session, {
      status: 'session_received',
      upload_received_at: new Date().toISOString(),
    });
    await this.publishStatus(received);

    const importing = await this.updateSession(received, {
      status: 'importing',
    });
    await this.publishStatus(importing);

    try {
      const importRequest: ISecureConnectionImportRequest = {
        worker_id: importing.worker_id,
        account_id: importing.account_id,
        worker_type_id: importing.worker_type_id,
        connection_attempt_id: importing.connection_attempt_id,
        runtime_generation: importing.runtime_generation,
        format_version: input.package.format_version,
        source: input.package.source,
        target_provider: input.package.target_provider,
        payload_ref: payloadRef,
        checksum: input.package.checksum,
        debug_trace_id: input.debugTraceId,
      };

      const imported =
        await this.workerBaileysGrpcClientService.importSecureSession(
          importing.worker_id,
          importRequest,
          importing.worker_type_id
        );
      const connected = await this.updateSession(importing, {
        status: imported.session_ready ? 'connected' : 'failed',
        phone: imported.phone,
        imported_at: new Date().toISOString(),
        error: imported.session_ready ? undefined : imported.error,
        fail_reason: imported.session_ready
          ? undefined
          : 'worker_import_failed',
      });
      await this.publishStatus(connected);

      return this.toResponse(connected);
    } catch (error) {
      const failed = await this.updateSession(importing, {
        status: 'failed',
        error: this.sanitizeError(error),
        fail_reason: 'worker_import_failed',
      });
      await this.publishStatus(failed);

      return this.toResponse(failed);
    }
  }

  private async resolveWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ) {
    const existsWorker = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorker) {
      throw new Error(t('worker_not_found'));
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    return worker;
  }

  private isSupportedWorkerType(workerTypeId: EWorkerType): boolean {
    return (
      workerTypeId === EWorkerType.baileys ||
      workerTypeId === EWorkerType.wwebjs ||
      workerTypeId === EWorkerType.whatsmeow
    );
  }

  private targetProviderForWorkerType(
    workerTypeId?: EWorkerType
  ): SecureConnectionTargetProvider | undefined {
    if (workerTypeId === EWorkerType.baileys) return 'baileys';
    if (workerTypeId === EWorkerType.wwebjs) return 'wwebjs';
    if (workerTypeId === EWorkerType.whatsmeow) return 'whatsmeow';
    return undefined;
  }

  private validateSessionPackage(
    t: TFunction<'translation', undefined>,
    session: ISecureConnectionSession,
    pkg: ISecureConnectionSessionPackage
  ): void {
    if (!pkg.format_version?.trim() || pkg.source !== 'whatsapp_web') {
      throw new Error(t('worker_secure_connection_session_invalid'));
    }

    const expectedProvider = this.targetProviderForWorkerType(
      session.worker_type_id
    );
    if (
      pkg.target_provider &&
      pkg.target_provider !== 'auto' &&
      expectedProvider &&
      pkg.target_provider !== expectedProvider
    ) {
      throw new Error(t('worker_secure_connection_provider_mismatch'));
    }

    if (!pkg.payload_ref && pkg.payload === undefined) {
      throw new Error(t('worker_secure_connection_session_invalid'));
    }

    if (pkg.checksum) {
      const checksumInput =
        pkg.payload_ref ?? JSON.stringify(pkg.payload ?? null);
      const checksum = this.sha256(checksumInput);
      if (checksum !== pkg.checksum) {
        throw new Error(t('worker_secure_connection_checksum_invalid'));
      }
    }
  }

  private async getSessionOrThrow(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<ISecureConnectionSession> {
    const raw = await this.redis.get(this.sessionKey(token));
    if (!raw) {
      throw new Error(t('worker_secure_connection_session_not_found'));
    }

    const session = JSON.parse(raw) as ISecureConnectionSession;
    if (Date.parse(session.expires_at) <= Date.now()) {
      const expired = await this.updateSession(session, { status: 'expired' });
      await this.publishStatus(expired);
      throw new Error(t('worker_secure_connection_session_expired'));
    }

    return session;
  }

  private assertSameWorker(
    t: TFunction<'translation', undefined>,
    session: ISecureConnectionSession,
    accountId: string,
    workerId: string
  ): void {
    if (session.account_id !== accountId || session.worker_id !== workerId) {
      throw new Error(t('worker_not_found'));
    }
  }

  private normalizeStatus(
    t: TFunction<'translation', undefined>,
    status: string
  ): SecureConnectionStatus {
    if (!SECURE_CONNECTION_STATUSES_SET.has(status)) {
      throw new Error(t('worker_secure_connection_status_invalid'));
    }

    return status as SecureConnectionStatus;
  }

  private isTerminalStatus(status: SecureConnectionStatus): boolean {
    return (
      status === 'connected' ||
      status === 'failed' ||
      status === 'expired' ||
      status === 'cancelled'
    );
  }

  private async saveSession(session: ISecureConnectionSession): Promise<void> {
    await this.redis.set(
      this.sessionKey(session.token),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS
    );
  }

  private async updateSession(
    session: ISecureConnectionSession,
    patch: Partial<ISecureConnectionSession>
  ): Promise<ISecureConnectionSession> {
    const next: ISecureConnectionSession = {
      ...session,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await this.saveSession(next);
    if (this.isTerminalStatus(next.status) && next.worker_type_id) {
      await this.redis.del(
        this.activeSessionKey(next.worker_id, next.worker_type_id)
      );
    }

    return next;
  }

  private async storePayload(
    token: string,
    pkg: ISecureConnectionSessionPackage
  ): Promise<string> {
    const payloadRef = this.payloadKey(token);
    await this.redis.set(
      payloadRef,
      JSON.stringify(pkg),
      'EX',
      PAYLOAD_TTL_SECONDS
    );
    return payloadRef;
  }

  private async publishStatus(
    session: ISecureConnectionSession,
    extra: { message?: string } = {}
  ): Promise<void> {
    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(session.account_id),
      {
        secure_connection: this.toResponse(session),
        worker_id: session.worker_id,
        account_id: session.account_id,
        message: extra.message,
      }
    );
  }

  private toResponse(
    session: ISecureConnectionSession,
    options: { includeToken?: boolean } = {}
  ): WorkerSecureConnectionSessionResponse {
    return {
      token: options.includeToken ? session.token : undefined,
      token_hash: session.token_hash,
      deep_link: options.includeToken ? session.deep_link : undefined,
      status: session.status,
      worker_id: session.worker_id,
      worker_type_id: session.worker_type_id,
      connection_attempt_id: session.connection_attempt_id,
      runtime_generation: session.runtime_generation,
      expires_at: session.expires_at,
      helper_download_url: process.env.PASSKEY_HELPER_DOWNLOAD_URL,
      message: session.fail_reason,
      error: session.error,
      phone: session.phone,
    };
  }

  private buildDeepLink(token: string, apiBaseUrl: string): string {
    const params = new URLSearchParams({
      api: apiBaseUrl.replace(/\/+$/, ''),
      token,
    });

    return `${SECURE_HELPER_PROTOCOL}://${SECURE_HELPER_HOST}?${params.toString()}`;
  }

  private createToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return this.sha256(token).slice(0, 12);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private sessionKey(token: string): string {
    return `connection:secure:session:${token}`;
  }

  private payloadKey(token: string): string {
    return `connection:secure:payload:${token}`;
  }

  private activeSessionKey(workerId: string, workerTypeId: string): string {
    return `connection:secure:active:${workerTypeId}:${workerId}`;
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message.slice(0, 240);
    }

    return String(error).slice(0, 240);
  }

  private logFlow(
    event: string,
    session: ISecureConnectionSession,
    details: Record<string, unknown> = {}
  ): void {
    logConnectionFlowConsole(event, {
      layer: 'manager.secure_connection',
      worker_id: session.worker_id,
      account_id: session.account_id,
      worker_type_id: session.worker_type_id,
      connection_attempt_id: session.connection_attempt_id,
      status: session.status,
      token_hash: session.token_hash,
      ...details,
    });
  }
}
