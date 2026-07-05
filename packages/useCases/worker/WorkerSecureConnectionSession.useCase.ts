import { createHash, randomBytes } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import {
  channelsConfigCentrifugo,
  workerCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { currentTime } from '@core/common/functions/currentTime';
import {
  ISecureConnectionImportRequest,
  ISecureConnectionSession,
  ISecureConnectionSessionPackage,
  SecureConnectionStatus,
  SecureConnectionTargetProvider,
  SECURE_CONNECTION_STATUSES,
} from '@core/common/interfaces/ISecureConnectionSession';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerService } from '@core/services/worker.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';
import { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';

const SECURE_HELPER_PROTOCOL = 'underchat-authenticator';
const SECURE_HELPER_HOST = 'secure';
const SESSION_TTL_SECONDS = Math.max(
  300,
  Number(process.env.SECURE_CONNECTION_SESSION_TTL_SECONDS) || 900
);
const PAYLOAD_TTL_SECONDS = Math.max(
  SESSION_TTL_SECONDS,
  Number(process.env.SECURE_CONNECTION_PAYLOAD_TTL_SECONDS) || 1800
);
const SECURE_IMPORT_VALIDATION_TIMEOUT_MS = Math.max(
  20_000,
  Number(process.env.SECURE_CONNECTION_WORKER_VALIDATION_TIMEOUT_MS) || 60_000
);
const SECURE_IMPORT_VALIDATION_STABLE_MS = Math.max(
  5_000,
  Number(process.env.SECURE_CONNECTION_WORKER_VALIDATION_STABLE_MS) || 20_000
);
const SECURE_IMPORT_VALIDATION_POLL_MS = Math.max(
  500,
  Number(process.env.SECURE_CONNECTION_WORKER_VALIDATION_POLL_MS) || 1_000
);

const SECURE_CONNECTION_STATUSES_SET = new Set<string>(
  SECURE_CONNECTION_STATUSES
);

const SECURE_CONNECTION_HELPER_STATUSES_SET = new Set<string>([
  'helper_opened',
  'wa_authenticated',
  'wa_syncing',
  'wa_ready',
  'uploading',
  'failed',
]);
const SECURE_CONNECTION_STATUS_ORDER: Record<SecureConnectionStatus, number> = {
  created: 0,
  helper_opened: 1,
  wa_authenticated: 2,
  wa_syncing: 2,
  wa_ready: 2,
  uploading: 3,
  session_received: 4,
  importing: 5,
  validating_worker: 6,
  connected: 6,
  connected_confirmed: 7,
  failed: 7,
  expired: 7,
  cancelled: 7,
};

const SECURE_CONNECTION_ALLOWED_WORKER_STATUSES = new Set<string>([
  EWorkerStatus.disponible,
  EWorkerStatus.creating,
  EWorkerStatus.recreating,
]);
const SECURE_CONNECTION_MANAGER_OWNED_IMPORT_STATUSES = new Set<string>([
  'session_received',
  'importing',
  'validating_worker',
  'connected',
]);
const SECURE_IMPORT_TERMINAL_DEGRADED_REASONS = new Set<string>([
  'auth_failure',
  'bad_session',
  'connection_replaced',
  'device_deleted',
  'device_removed',
  'forbidden',
  'invalid_session',
  'logged_out',
  'multidevice_mismatch',
  'not_authorized',
  'session_invalid',
  'stream_replaced',
]);

@injectable()
export class WorkerSecureConnectionSessionUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject('Redis') private readonly redis: Redis,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
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
    this.logEvent('manager.secure_connection.create.start', {
      trace_id: input.debugTraceId,
      worker_id: input.workerId,
      account_id: input.accountId,
      api_base_url: input.apiBaseUrl,
      ttl_seconds: SESSION_TTL_SECONDS,
    });

    const worker = await this.resolveWorker(t, input.accountId, input.workerId);
    const workerTypeId = worker.type?.id as EWorkerType | undefined;
    const workerStatusId = worker.status?.id;
    const serverId = worker.server?.id;

    this.logEvent('manager.secure_connection.create.worker_resolved', {
      trace_id: input.debugTraceId,
      worker_id: input.workerId,
      account_id: input.accountId,
      worker_type_id: workerTypeId,
      worker_status_id: workerStatusId,
      server_id: serverId,
    });

    if (!workerTypeId || !this.isSupportedWorkerType(workerTypeId)) {
      this.logEvent('manager.secure_connection.create.worker_type_invalid', {
        trace_id: input.debugTraceId,
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: workerTypeId,
      });
      throw new Error(t('worker_type_invalid'));
    }

    if (!serverId) {
      this.logEvent('manager.secure_connection.create.server_missing', {
        trace_id: input.debugTraceId,
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: workerTypeId,
      });
      throw new Error(t('worker_not_found'));
    }

    if (
      workerStatusId &&
      !SECURE_CONNECTION_ALLOWED_WORKER_STATUSES.has(workerStatusId)
    ) {
      this.logEvent('manager.secure_connection.create.worker_not_ready', {
        trace_id: input.debugTraceId,
        worker_id: input.workerId,
        account_id: input.accountId,
        worker_type_id: workerTypeId,
        worker_status_id: workerStatusId,
      });
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
      server_id: serverId,
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
      trace_id: input.debugTraceId,
      helper_protocol: SECURE_HELPER_PROTOCOL,
      expires_at: session.expires_at,
      runtime_generation: session.runtime_generation,
      server_id: session.server_id,
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
    this.logEvent('manager.secure_connection.view.start', {
      worker_id: input.workerId,
      account_id: input.accountId,
      token_hash: this.hashToken(input.token),
    });

    const session = await this.getSessionOrThrow(t, input.token);
    this.assertSameWorker(t, session, input.accountId, input.workerId);
    const recovered =
      session.status === 'importing'
        ? session
        : await this.recoverImportedRuntimeIfReady(
            t,
            session,
            'authenticated_view'
          );
    this.logFlow('manager.secure_connection.view.done', recovered, {
      previous_status: session.status,
    });

    return this.toResponse(recovered, { includeToken: true });
  }

  async cancelAuthenticated(
    t: TFunction<'translation', undefined>,
    input: {
      accountId: string;
      workerId: string;
      token: string;
    }
  ): Promise<WorkerSecureConnectionSessionResponse> {
    this.logEvent('manager.secure_connection.cancel.start', {
      worker_id: input.workerId,
      account_id: input.accountId,
      token_hash: this.hashToken(input.token),
    });

    const session = await this.getSessionOrThrow(t, input.token);
    this.assertSameWorker(t, session, input.accountId, input.workerId);

    const cancelled = await this.updateSession(session, {
      status: 'cancelled',
      fail_reason: 'cancelled_by_user',
    });
    await this.publishStatus(cancelled);
    this.logFlow('manager.secure_connection.cancel.done', cancelled);

    return this.toResponse(cancelled, { includeToken: true });
  }

  async viewForHelper(
    t: TFunction<'translation', undefined>,
    token: string
  ): Promise<WorkerSecureConnectionSessionResponse> {
    this.logEvent('manager.secure_connection.helper_view.start', {
      token_hash: this.hashToken(token),
    });

    const session = await this.getSessionOrThrow(t, token);

    if (session.status === 'created') {
      const opened = await this.updateSession(session, {
        status: 'helper_opened',
      });
      await this.publishStatus(opened);
      this.logFlow('manager.secure_connection.helper_view.opened', opened);
      return this.toResponse(opened);
    }

    const recovered = await this.recoverImportedRuntimeIfReady(
      t,
      session,
      'helper_view'
    );
    if (recovered.status !== session.status) {
      return this.toResponse(recovered);
    }

    this.logFlow('manager.secure_connection.helper_view.done', session);
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
    this.logEvent('manager.secure_connection.helper_status.start', {
      token_hash: this.hashToken(input.token),
      requested_status: input.status,
      helper_version: input.helperVersion,
      helper_platform: input.helperPlatform,
      has_error: Boolean(input.error),
    });

    const session = await this.getSessionOrThrow(t, input.token);
    if (this.isTerminalStatus(session.status)) {
      this.logFlow(
        'manager.secure_connection.helper_status.ignored_terminal',
        session,
        {
          requested_status: input.status,
        }
      );
      return this.toResponse(session);
    }

    const nextStatus = this.normalizeStatus(t, input.status);
    if (
      nextStatus === 'failed' &&
      this.isManagerOwnedImportStatus(session.status)
    ) {
      const recovered = await this.recoverImportedRuntimeIfReady(
        t,
        session,
        'helper_status_failed'
      );
      this.logFlow(
        'manager.secure_connection.helper_status.ignored_manager_owned_failed',
        recovered,
        {
          requested_status: input.status,
          current_status: session.status,
          recovered_status: recovered.status,
          has_error: Boolean(input.error),
        }
      );
      return this.toResponse(recovered);
    }

    if (!SECURE_CONNECTION_HELPER_STATUSES_SET.has(nextStatus)) {
      this.logFlow('manager.secure_connection.helper_status.invalid', session, {
        requested_status: input.status,
      });
      throw new Error(t('worker_secure_connection_status_invalid'));
    }

    if (this.isStatusRegression(session.status, nextStatus)) {
      this.logFlow(
        'manager.secure_connection.helper_status.ignored_regression',
        session,
        {
          requested_status: input.status,
          current_status: session.status,
        }
      );
      return this.toResponse(session);
    }

    const helperMetadataChanged =
      (input.helperVersion !== undefined &&
        input.helperVersion !== session.helper_version) ||
      (input.helperPlatform !== undefined &&
        input.helperPlatform !== session.helper_platform);

    if (
      session.status === nextStatus &&
      !input.error &&
      !input.message &&
      !helperMetadataChanged
    ) {
      this.logFlow(
        'manager.secure_connection.helper_status.ignored_duplicate',
        session,
        {
          requested_status: input.status,
        }
      );
      return this.toResponse(session);
    }

    const next = await this.updateSession(session, {
      status: nextStatus,
      helper_version: input.helperVersion,
      helper_platform: input.helperPlatform,
      error: input.error,
      fail_reason: input.error ? 'helper_error' : session.fail_reason,
    });

    await this.publishStatus(next, { message: input.message });
    this.logFlow('manager.secure_connection.helper_status.done', next, {
      previous_status: session.status,
      requested_status: input.status,
      helper_version: input.helperVersion,
      helper_platform: input.helperPlatform,
      has_error: Boolean(input.error),
    });

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
    this.logEvent('manager.secure_connection.session_upload.start', {
      trace_id: input.debugTraceId,
      token_hash: this.hashToken(input.token),
      format_version: input.package.format_version,
      source: input.package.source,
      target_provider: input.package.target_provider,
      web_version: input.package.web_version,
      has_payload_ref: Boolean(input.package.payload_ref),
      has_payload: input.package.payload !== undefined,
      has_checksum: Boolean(input.package.checksum),
    });

    const session = await this.getSessionOrThrow(t, input.token);

    if (this.isTerminalStatus(session.status)) {
      this.logFlow(
        'manager.secure_connection.session_upload.rejected_terminal',
        session,
        {
          trace_id: input.debugTraceId,
          upload_status: session.status,
        }
      );
      throw new Error(t('worker_secure_connection_status_invalid'));
    }

    if (session.upload_received_at) {
      const recovered = await this.recoverImportedRuntimeIfReady(
        t,
        session,
        'duplicate_upload'
      );
      if (recovered.status === 'connected_confirmed') {
        return this.toResponse(recovered);
      }

      if (this.isManagerOwnedImportStatus(recovered.status)) {
        this.logFlow(
          'manager.secure_connection.session_upload.duplicate_in_progress',
          recovered,
          {
            trace_id: input.debugTraceId,
          }
        );
        return this.toResponse(recovered);
      }

      this.logFlow(
        'manager.secure_connection.session_upload.rejected_duplicate',
        recovered,
        {
          trace_id: input.debugTraceId,
        }
      );
      throw new Error(t('worker_secure_connection_session_already_uploaded'));
    }

    this.validateSessionPackage(t, session, input.package);
    this.logFlow(
      'manager.secure_connection.session_upload.validated',
      session,
      {
        trace_id: input.debugTraceId,
        format_version: input.package.format_version,
        target_provider: input.package.target_provider,
        has_payload_ref: Boolean(input.package.payload_ref),
        has_payload: input.package.payload !== undefined,
        has_checksum: Boolean(input.package.checksum),
      }
    );

    const payloadRef = await this.storePayload(input.token, input.package);
    this.logFlow(
      'manager.secure_connection.session_upload.payload_stored',
      session,
      {
        trace_id: input.debugTraceId,
        payload_ref: payloadRef,
        payload_ttl_seconds: PAYLOAD_TTL_SECONDS,
      }
    );

    const received = await this.updateSession(session, {
      status: 'session_received',
      upload_received_at: new Date().toISOString(),
    });
    await this.publishStatus(received);

    const importing = await this.updateSession(received, {
      status: 'importing',
    });
    await this.publishStatus(importing);
    this.logFlow(
      'manager.secure_connection.session_upload.importing',
      importing,
      {
        trace_id: input.debugTraceId,
      }
    );

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

      const serverId = await this.resolveSessionServerId(t, importing);

      this.logFlow('manager.secure_connection.import.grpc_call', importing, {
        trace_id: input.debugTraceId,
        payload_ref: importRequest.payload_ref,
        format_version: importRequest.format_version,
        target_provider: importRequest.target_provider,
        runtime_generation: importRequest.runtime_generation,
        server_id: serverId,
      });

      const imported = await this.workerGrpcClientService.importSecureSession(
        serverId,
        importRequest
      );

      const currentAfterImport = await this.getSessionForImportContinuation(
        t,
        input.token,
        importing,
        'after_grpc_import'
      );
      if (this.isTerminalStatus(currentAfterImport.status)) {
        return this.toResponse(currentAfterImport);
      }

      const importedReadiness =
        this.resolveImportedConnectionReadiness(imported);
      const validating = await this.updateSession(currentAfterImport, {
        status: 'validating_worker',
        phone: importedReadiness.phone ?? imported.phone,
        imported_at: new Date().toISOString(),
      });
      await this.publishStatus(validating);
      const validationStableMs = this.resolveSecureImportValidationStableMs(
        validating,
        importedReadiness
      );
      this.logFlow(
        'manager.secure_connection.import.validation_started',
        validating,
        {
          trace_id: input.debugTraceId,
          imported_status: imported.status,
          imported_code: imported.code,
          imported_reason: imported.reason,
          session_ready: imported.session_ready,
          authenticated: imported.authenticated,
          can_send: imported.can_send,
          can_receive_runtime: imported.can_receive_runtime,
          worker_status_id: imported.worker_status_id,
          immediate_readiness_ready: importedReadiness.ready,
          immediate_readiness_reason: importedReadiness.reason,
          phone_present: Boolean(imported.phone),
          validation_timeout_ms: SECURE_IMPORT_VALIDATION_TIMEOUT_MS,
          validation_stable_ms: validationStableMs,
        }
      );

      const validation = await this.waitForStableImportedRuntimeHealth(
        validating,
        serverId,
        imported,
        importedReadiness,
        input.debugTraceId
      );

      if (validation.ready) {
        await this.persistConnectedWorker(
          validating,
          validation.imported,
          validation
        );
      }

      const currentBeforeFinalize = await this.getSessionForImportContinuation(
        t,
        input.token,
        validating,
        'before_validation_result'
      );
      if (this.isTerminalStatus(currentBeforeFinalize.status)) {
        return this.toResponse(currentBeforeFinalize);
      }

      const connected = await this.updateSession(currentBeforeFinalize, {
        status: validation.ready ? 'connected_confirmed' : 'failed',
        phone: validation.phone ?? importedReadiness.phone ?? imported.phone,
        error: validation.ready
          ? undefined
          : this.resolveImportFailureMessage(imported, validation),
        fail_reason: validation.ready
          ? undefined
          : (validation.reason ?? 'worker_runtime_validation_failed'),
      });
      await this.publishStatus(connected);
      this.logFlow(
        'manager.secure_connection.import.validation_result',
        connected,
        {
          trace_id: input.debugTraceId,
          imported_status: imported.status,
          imported_code: imported.code,
          imported_reason: imported.reason,
          session_ready: imported.session_ready,
          authenticated: imported.authenticated,
          can_send: imported.can_send,
          can_receive_runtime: imported.can_receive_runtime,
          worker_status_id: imported.worker_status_id,
          immediate_readiness_ready: importedReadiness.ready,
          immediate_readiness_reason: importedReadiness.reason,
          validation_ready: validation.ready,
          validation_reason: validation.reason,
          validation_elapsed_ms: validation.elapsedMs,
          health_provider_state: validation.health?.provider_state,
          health_degraded_reason: validation.health?.degraded_reason,
          health_session_ready: validation.health?.session_ready,
          health_authenticated: validation.health?.authenticated,
          health_can_send: validation.health?.can_send,
          health_can_receive_runtime: validation.health?.can_receive_runtime,
          health_phone_present: Boolean(validation.health?.phone),
          phone_present: Boolean(imported.phone),
        }
      );

      return this.toResponse(connected);
    } catch (error) {
      const currentBeforeFailure = await this.getSessionForImportContinuation(
        t,
        input.token,
        importing,
        'before_import_error'
      );
      if (this.isTerminalStatus(currentBeforeFailure.status)) {
        return this.toResponse(currentBeforeFailure);
      }

      const failed = await this.updateSession(currentBeforeFailure, {
        status: 'failed',
        error: this.sanitizeError(error),
        fail_reason: 'worker_import_failed',
      });
      await this.publishStatus(failed);
      this.logFlow('manager.secure_connection.import.grpc_error', failed, {
        trace_id: input.debugTraceId,
        reason: this.sanitizeError(error),
      });

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

  private async resolveSessionServerId(
    t: TFunction<'translation', undefined>,
    session: ISecureConnectionSession
  ): Promise<string> {
    if (session.server_id) {
      return session.server_id;
    }

    const worker = await this.resolveWorker(
      t,
      session.account_id,
      session.worker_id
    );
    const serverId = worker.server?.id;

    if (!serverId) {
      throw new Error(t('worker_not_found'));
    }

    return serverId;
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
      this.logEvent('manager.secure_connection.session.not_found', {
        token_hash: this.hashToken(token),
      });
      throw new Error(t('worker_secure_connection_session_not_found'));
    }

    const session = JSON.parse(raw) as ISecureConnectionSession;
    if (Date.parse(session.expires_at) <= Date.now()) {
      const expired = await this.updateSession(session, { status: 'expired' });
      await this.publishStatus(expired);
      this.logFlow('manager.secure_connection.session.expired', expired);
      throw new Error(t('worker_secure_connection_session_expired'));
    }

    return session;
  }

  private async getSessionForImportContinuation(
    t: TFunction<'translation', undefined>,
    token: string,
    fallback: ISecureConnectionSession,
    source: string
  ): Promise<ISecureConnectionSession> {
    const current = await this.getSessionOrThrow(t, token);

    if (this.isTerminalStatus(current.status)) {
      this.logFlow(
        'manager.secure_connection.import.continuation_skipped_terminal',
        current,
        {
          source,
          stale_status: fallback.status,
        }
      );
      return current;
    }

    if (this.isManagerOwnedImportStatus(current.status)) {
      return current;
    }

    this.logFlow(
      'manager.secure_connection.import.continuation_using_fallback',
      fallback,
      {
        source,
        current_status: current.status,
      }
    );
    return fallback;
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
      status === 'connected_confirmed' ||
      status === 'failed' ||
      status === 'expired' ||
      status === 'cancelled'
    );
  }

  private isManagerOwnedImportStatus(status: SecureConnectionStatus): boolean {
    return SECURE_CONNECTION_MANAGER_OWNED_IMPORT_STATUSES.has(status);
  }

  private isStatusRegression(
    currentStatus: SecureConnectionStatus,
    nextStatus: SecureConnectionStatus
  ): boolean {
    return (
      SECURE_CONNECTION_STATUS_ORDER[nextStatus] <
      SECURE_CONNECTION_STATUS_ORDER[currentStatus]
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

  private resolveImportedConnectionReadiness(
    imported: IBaileysConnectionState
  ): { phone: string | null; ready: boolean; reason?: string } {
    const phone = imported.phone?.trim() || null;
    const isConnectedStatus =
      imported.status === 'connected' ||
      imported.code === ECodeMessage.connectionEstablished;
    const isOnline = imported.worker_status_id === EWorkerStatus.online;
    const ready =
      isConnectedStatus &&
      isOnline &&
      imported.session_ready === true &&
      imported.authenticated === true &&
      imported.can_send === true &&
      imported.can_receive_runtime === true &&
      Boolean(phone);

    if (ready) {
      return { phone, ready: true };
    }

    const missing: string[] = [];
    if (!isConnectedStatus) missing.push('connected_status');
    if (!isOnline) missing.push('worker_online_status');
    if (imported.session_ready !== true) missing.push('session_ready');
    if (imported.authenticated !== true) missing.push('authenticated');
    if (imported.can_send !== true) missing.push('can_send');
    if (imported.can_receive_runtime !== true) {
      missing.push('can_receive_runtime');
    }
    if (!phone) missing.push('phone');

    return {
      phone,
      ready: false,
      reason: `secure_import_not_ready:${missing.join(',')}`,
    };
  }

  private resolveSecureImportValidationStableMs(
    session: ISecureConnectionSession,
    importedReadiness: { ready?: boolean }
  ): number {
    if (
      session.worker_type_id === EWorkerType.whatsmeow &&
      importedReadiness.ready === true
    ) {
      return 0;
    }

    return SECURE_IMPORT_VALIDATION_STABLE_MS;
  }

  private async waitForStableImportedRuntimeHealth(
    session: ISecureConnectionSession,
    serverId: string,
    imported: IBaileysConnectionState,
    importedReadiness: {
      phone: string | null;
      ready: boolean;
      reason?: string;
    },
    debugTraceId?: string
  ): Promise<{
    ready: boolean;
    phone: string | null;
    reason?: string;
    health?: IWorkerRuntimeHealthResponseProto;
    imported: IBaileysConnectionState;
    elapsedMs: number;
  }> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + SECURE_IMPORT_VALIDATION_TIMEOUT_MS;
    const stableRequiredMs = this.resolveSecureImportValidationStableMs(
      session,
      importedReadiness
    );
    let stableSince: number | null = null;
    let lastHealth: IWorkerRuntimeHealthResponseProto | undefined;
    let lastReason =
      importedReadiness.reason ?? 'secure_import_runtime_validation_pending';

    while (Date.now() <= deadlineAt) {
      let health: IWorkerRuntimeHealthResponseProto | undefined;

      try {
        health = await this.workerGrpcClientService.runtimeHealth(serverId, {
          worker_id: session.worker_id,
        });
      } catch (error) {
        lastReason = `runtime_health_error:${this.sanitizeError(error)}`;
        this.logFlow(
          'manager.secure_connection.import.validation_probe_error',
          session,
          {
            trace_id: debugTraceId,
            reason: lastReason,
            elapsed_ms: Date.now() - startedAt,
            stable_elapsed_ms:
              stableSince === null ? 0 : Date.now() - stableSince,
          }
        );

        if (stableSince !== null) {
          break;
        }

        await this.delay(SECURE_IMPORT_VALIDATION_POLL_MS);
        continue;
      }

      lastHealth = health;
      const readiness = this.resolveRuntimeHealthReadiness(
        health,
        session,
        importedReadiness.phone ?? imported.phone
      );
      lastReason = readiness.reason ?? 'secure_import_runtime_not_ready';

      this.logFlow(
        'manager.secure_connection.import.validation_probe',
        session,
        {
          trace_id: debugTraceId,
          ready: readiness.ready,
          reason: readiness.reason,
          elapsed_ms: Date.now() - startedAt,
          stable_elapsed_ms:
            stableSince === null ? 0 : Date.now() - stableSince,
          stable_required_ms: stableRequiredMs,
          worker_type_id: health.worker_type_id,
          runtime_generation: health.runtime_generation,
          session_ready: health.session_ready,
          authenticated: health.authenticated,
          can_send: health.can_send,
          can_receive_runtime: health.can_receive_runtime,
          activated: health.activated,
          standby: health.standby,
          provider_state: health.provider_state,
          degraded_reason: health.degraded_reason,
          kafka_unhealthy: health.kafka_unhealthy,
          phone_present: Boolean(readiness.phone),
          error_present: Boolean(health.error),
        }
      );

      if (readiness.hardFailure) {
        break;
      }

      if (readiness.ready) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stableRequiredMs) {
          return {
            ready: true,
            phone: readiness.phone,
            health,
            imported: this.buildValidatedConnectionState(
              session,
              imported,
              health,
              readiness.phone
            ),
            elapsedMs: Date.now() - startedAt,
          };
        }
      } else if (stableSince !== null) {
        lastReason = `secure_import_runtime_health_lost:${readiness.reason}`;
        break;
      }

      await this.delay(SECURE_IMPORT_VALIDATION_POLL_MS);
    }

    return {
      ready: false,
      phone:
        this.normalizeConnectionPhone(lastHealth?.phone) ??
        importedReadiness.phone ??
        this.normalizeConnectionPhone(imported.phone),
      reason:
        lastReason === 'secure_import_runtime_validation_pending'
          ? 'secure_import_runtime_validation_timeout'
          : lastReason,
      health: lastHealth,
      imported,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async recoverImportedRuntimeIfReady(
    t: TFunction<'translation', undefined>,
    session: ISecureConnectionSession,
    source: string
  ): Promise<ISecureConnectionSession> {
    if (!this.isManagerOwnedImportStatus(session.status)) {
      return session;
    }

    let serverId: string;
    try {
      serverId = await this.resolveSessionServerId(t, session);
    } catch (error) {
      this.logFlow(
        'manager.secure_connection.import.recovery_skipped',
        session,
        {
          source,
          reason: this.sanitizeError(error),
        }
      );
      return session;
    }

    let health: IWorkerRuntimeHealthResponseProto;
    try {
      health = await this.workerGrpcClientService.runtimeHealth(serverId, {
        worker_id: session.worker_id,
      });
    } catch (error) {
      this.logFlow(
        'manager.secure_connection.import.recovery_probe_error',
        session,
        {
          source,
          reason: this.sanitizeError(error),
        }
      );
      return session;
    }

    const readiness = this.resolveRuntimeHealthReadiness(
      health,
      session,
      session.phone
    );
    this.logFlow('manager.secure_connection.import.recovery_probe', session, {
      source,
      ready: readiness.ready,
      reason: readiness.reason,
      worker_type_id: health.worker_type_id,
      runtime_generation: health.runtime_generation,
      session_ready: health.session_ready,
      authenticated: health.authenticated,
      can_send: health.can_send,
      can_receive_runtime: health.can_receive_runtime,
      activated: health.activated,
      standby: health.standby,
      provider_state: health.provider_state,
      degraded_reason: health.degraded_reason,
      kafka_unhealthy: health.kafka_unhealthy,
      phone_present: Boolean(readiness.phone),
      error_present: Boolean(health.error),
    });

    if (!readiness.ready) {
      return session;
    }

    const imported = this.buildValidatedConnectionState(
      session,
      {
        worker_id: session.worker_id,
        account_id: session.account_id,
        worker_type_id: session.worker_type_id,
        connection_attempt_id: session.connection_attempt_id,
        runtime_generation: session.runtime_generation,
      } as IBaileysConnectionState,
      health,
      readiness.phone
    );
    await this.persistConnectedWorker(session, imported, readiness);

    const connected = await this.updateSession(session, {
      status: 'connected_confirmed',
      phone: readiness.phone ?? session.phone,
      error: undefined,
      fail_reason: undefined,
      imported_at: session.imported_at ?? new Date().toISOString(),
    });
    await this.publishStatus(connected);
    this.logFlow(
      'manager.secure_connection.import.recovery_connected',
      connected,
      {
        source,
        phone_present: Boolean(readiness.phone),
      }
    );

    return connected;
  }

  private resolveRuntimeHealthReadiness(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    session: ISecureConnectionSession,
    phoneFallback?: string | null
  ): {
    hardFailure: boolean;
    phone: string | null;
    ready: boolean;
    reason?: string;
  } {
    const phone =
      this.normalizeConnectionPhone(health?.phone) ??
      this.normalizeConnectionPhone(phoneFallback);
    const providerState = (health?.provider_state ?? '').toLowerCase();
    const providerStateReady = this.isRuntimeProviderStateReady(
      session.worker_type_id,
      providerState
    );
    const terminalDegradedReason = this.isTerminalRuntimeDegradedReason(
      health?.degraded_reason
    );
    const healthGeneration = this.normalizeOptionalNumber(
      health?.runtime_generation
    );
    const generationMismatch =
      session.runtime_generation !== undefined &&
      healthGeneration !== undefined &&
      session.runtime_generation !== healthGeneration;
    const hardFailure = Boolean(
      health?.error ||
      terminalDegradedReason ||
      health?.kafka_unhealthy === true ||
      generationMismatch
    );
    const ready =
      health?.session_ready === true &&
      health?.can_send === true &&
      health?.can_receive_runtime === true &&
      health?.authenticated === true &&
      health?.activated === true &&
      health?.standby !== true &&
      (!health?.worker_type_id ||
        health.worker_type_id === session.worker_type_id) &&
      health?.kafka_unhealthy !== true &&
      !health?.error &&
      !health?.degraded_reason &&
      providerStateReady &&
      Boolean(phone) &&
      !generationMismatch;

    if (ready) {
      return { hardFailure: false, phone, ready: true };
    }

    const missing: string[] = [];
    if (health?.session_ready !== true) missing.push('session_ready');
    if (health?.authenticated !== true) missing.push('authenticated');
    if (health?.can_send !== true) missing.push('can_send');
    if (health?.can_receive_runtime !== true) {
      missing.push('can_receive_runtime');
    }
    if (health?.activated !== true) missing.push('activated');
    if (health?.standby === true) missing.push('standby');
    if (
      health?.worker_type_id &&
      health.worker_type_id !== session.worker_type_id
    ) {
      missing.push('worker_type_mismatch');
    }
    if (!providerStateReady) missing.push('provider_state');
    if (health?.kafka_unhealthy === true) missing.push('kafka_unhealthy');
    if (health?.error) missing.push('runtime_error');
    if (health?.degraded_reason) missing.push('degraded_reason');
    if (generationMismatch) missing.push('runtime_generation_mismatch');
    if (!phone) missing.push('phone');

    return {
      hardFailure,
      phone,
      ready: false,
      reason: `secure_import_runtime_not_ready:${missing.join(',')}`,
    };
  }

  private isRuntimeProviderStateReady(
    workerTypeId: EWorkerType | undefined,
    providerState: string
  ): boolean {
    const normalized = providerState.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    if (workerTypeId === EWorkerType.baileys) {
      return normalized === 'open' || normalized === 'connected';
    }

    if (workerTypeId === EWorkerType.wwebjs) {
      return normalized === 'connected' || normalized === 'open';
    }

    return normalized === 'connected';
  }

  private isTerminalRuntimeDegradedReason(
    degradedReason?: string | null
  ): boolean {
    const normalized = degradedReason?.trim().toLowerCase();
    return Boolean(
      normalized && SECURE_IMPORT_TERMINAL_DEGRADED_REASONS.has(normalized)
    );
  }

  private buildValidatedConnectionState(
    session: ISecureConnectionSession,
    imported: IBaileysConnectionState,
    health: IWorkerRuntimeHealthResponseProto,
    phone: string | null
  ): IBaileysConnectionState {
    return {
      ...imported,
      account_id: imported.account_id || session.account_id,
      authenticated: true,
      can_receive_runtime: true,
      can_send: true,
      code: imported.code ?? ECodeMessage.connectionEstablished,
      connection_attempt_id:
        imported.connection_attempt_id ?? session.connection_attempt_id,
      debug_trace_id: imported.debug_trace_id,
      degraded_reason: undefined,
      error: undefined,
      last_probe_at: health.last_probe_at,
      phone: phone ?? undefined,
      probe_latency_ms: this.normalizeOptionalNumber(health.probe_latency_ms),
      provider_state: health.provider_state || 'connected',
      runtime_generation:
        this.normalizeOptionalNumber(health.runtime_generation) ??
        imported.runtime_generation ??
        session.runtime_generation,
      session_ready: true,
      status: imported.status || 'connected',
      worker_id: imported.worker_id || session.worker_id,
      worker_status_id: EWorkerStatus.online,
      worker_type_id: imported.worker_type_id ?? session.worker_type_id,
    };
  }

  private normalizeConnectionPhone(value?: string | null): string | null {
    const phone = value?.trim();
    return phone || null;
  }

  private normalizeOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private resolveImportFailureMessage(
    imported: IBaileysConnectionState,
    readiness: { reason?: string }
  ): string {
    return (
      imported.error?.trim() ||
      imported.reason?.trim() ||
      imported.degraded_reason?.trim() ||
      readiness.reason ||
      'secure_import_not_ready'
    );
  }

  private async persistConnectedWorker(
    session: ISecureConnectionSession,
    imported: IBaileysConnectionState,
    readiness: { phone: string | null }
  ): Promise<void> {
    const connectionDate = currentTime();
    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: session.worker_id,
      status: EWorkerStatus.online,
      number: readiness.phone,
      connection_date: connectionDate,
    });

    const payload: IBaileysConnectionState = {
      ...imported,
      code: imported.code ?? ECodeMessage.connectionEstablished,
      status: imported.status || 'connected',
      worker_id: session.worker_id,
      account_id: session.account_id,
      worker_type_id: session.worker_type_id,
      worker_status_id: EWorkerStatus.online,
      phone: readiness.phone ?? undefined,
      connection_attempt_id: session.connection_attempt_id,
      runtime_generation: session.runtime_generation,
      debug_trace_id: imported.debug_trace_id,
      session_ready: true,
      authenticated: true,
      can_send: true,
      can_receive_runtime: true,
    };

    await this.centrifugoService.publish(channelsConfigCentrifugo(), payload);
    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(session.account_id),
      payload
    );
    this.logFlow('manager.secure_connection.import.worker_persisted', session, {
      worker_status_id: EWorkerStatus.online,
      phone_present: Boolean(readiness.phone),
      connection_date: connectionDate,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      authenticated: payload.authenticated,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
    });
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
    this.logFlow('manager.secure_connection.status_published', session, {
      message_present: Boolean(extra.message),
    });
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

  private logEvent(event: string, details: Record<string, unknown> = {}): void {
    logConnectionFlowConsole(event, {
      layer: 'manager.secure_connection',
      ...details,
    });
  }

  private logFlow(
    event: string,
    session: ISecureConnectionSession,
    details: Record<string, unknown> = {}
  ): void {
    this.logEvent(event, {
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
