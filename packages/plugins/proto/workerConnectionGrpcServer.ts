import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  Server,
  ServerCredentials,
  sendUnaryData,
  ServerUnaryCall,
  status,
} from '@grpc/grpc-js';
import { container } from 'tsyringe';
import {
  baileysEnvironment,
  wwebjsEnvironment,
} from '@core/config/environments';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { resolveWorkerRuntimeKafkaHealthState } from '@core/common/functions/workerRuntimeKafkaHealth';
import { BaileysService } from '@core/services/baileys';
import { BaileysHealthCheckService } from '@core/services/baileys/methods/healthCheck.service';
import { WwebjsService } from '@core/services/wwebjs';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IWorkerRuntimeActivationRequestProto,
  IWorkerRuntimeActivationResponseProto,
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';
import { resolveWorkerRuntimeHealthWarmPoolIdentity } from '@core/common/functions/workerRuntimeHealthIdentity';
import { isWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import { activateWorkerRuntimeFence } from '@core/plugins/workerDatabase';
import {
  IPrepareProviderHandoffRequestProto,
  IPrepareProviderHandoffResponseProto,
  WhatsappSessionProvider,
} from '@core/common/interfaces/IProviderHandoffPrepareProto';
import type {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';

const protoPath = resolveProtoPath('worker_connection.proto');

const packageDefinition = loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = loadPackageDefinition(packageDefinition);
const workerConnectionProto = (protoDescriptor as any).worker_connection;

if (!workerConnectionProto?.WorkerConnection) {
  throw new Error('WorkerConnection service not found in proto');
}

const WorkerConnectionService = workerConnectionProto.WorkerConnection;

function logWorkerConnectionGrpcFlow(
  event: string,
  fields: Record<string, unknown>
): void {
  logConnectionFlowConsole(event, {
    layer: 'worker.connection_grpc_server',
    ...fields,
  });
}

interface IStatusConnectionRequestProto {
  worker_id?: string;
  status?: string;
  type?: string;
  phone_connection?: string;
  remove_session?: boolean;
  connection_attempt_id?: string;
  authorized_connection_epoch?: string;
  debug_trace_id?: string;
  runtime_generation?: number | string;
  warm_pool_id?: string;
  qr_pending?: boolean;
}

interface IPasskeyResponseRequestProto {
  worker_id?: string;
  account_id?: string;
  connection_attempt_id?: string;
  passkey_response?: string;
  debug_trace_id?: string;
}

interface IPasskeyConfirmationRequestProto {
  worker_id?: string;
  account_id?: string;
  connection_attempt_id?: string;
  debug_trace_id?: string;
}

interface ISecureSessionImportRequestProto {
  worker_id?: string;
  account_id?: string;
  worker_type_id?: string;
  connection_attempt_id?: string;
  runtime_generation?: number | string;
  format_version?: string;
  source?: string;
  target_provider?: string;
  payload_ref?: string;
  payload_json?: string;
  checksum?: string;
  debug_trace_id?: string;
  authorized_connection_epoch?: string;
}

interface IRawPrepareProviderHandoffRequestProto {
  worker_id?: string;
  account_id?: string;
  handoff_id?: string;
  lifecycle_operation_id?: string;
  source_provider?: string;
  target_provider?: string;
  source_revision_id?: number | string;
  runtime_generation?: number | string;
  debug_trace_id?: string;
}

interface IRawPrepareSessionStorageMigrationRequestProto {
  worker_id?: string;
  account_id?: string;
  migration_id?: string;
  provider?: string;
  source_volume_name?: string;
  runtime_generation?: number | string;
  expected_phone?: string;
  debug_trace_id?: string;
  runtime_capability?: string;
}

interface WorkerConnectionGrpcOptions {
  module?: ERouteModule;
  activateRuntime?: (
    fastify: FastifyInstance,
    request: IWorkerRuntimeActivationRequestProto
  ) => Promise<{ alreadyActive?: boolean } | void>;
  getKafkaUnhealthy?: () => boolean;
}

function optionalRuntimeGeneration(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
  }

  return undefined;
}

const workerConnectionGrpcServerPlugin: FastifyPluginAsync<
  WorkerConnectionGrpcOptions
> = async (fastify: FastifyInstance, options?: WorkerConnectionGrpcOptions) => {
  const module = options?.module ?? ERouteModule.worker_baileys;
  const connectionConsume =
    module === ERouteModule.worker_wwebjs
      ? container.resolve(WorkerConnectionStatusWwebjsConsume)
      : container.resolve(WorkerConnectionStatusConsume);
  const phoneValidationService =
    module === ERouteModule.worker_wwebjs
      ? container.resolve(WwebjsService)
      : container.resolve(BaileysService);
  const connectionLifecycleDebugService = container.resolve(
    ConnectionLifecycleDebugService
  );
  const grpcPort =
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.grpcPort
      : baileysEnvironment.grpcPort;
  const fallbackWorkerTypeId =
    module === ERouteModule.worker_wwebjs
      ? EWorkerType.wwebjs
      : EWorkerType.baileys;
  const grpcServer = new Server();
  let secureImportRuntimeGeneration: number | undefined;

  const getAccountId = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.wwebjsAccountId
      : baileysEnvironment.baileysAccountId;

  const getWorkerId = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.wwebjsWorkerId
      : baileysEnvironment.baileysWorkerId;

  const isWarmStandby = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.isWarmStandby
      : baileysEnvironment.isWarmStandby;

  const isRuntimeActivated = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.isRuntimeActivated
      : baileysEnvironment.isRuntimeActivated;

  const getWorkerTypeId = () =>
    (module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.workerTypeId
      : baileysEnvironment.workerTypeId) ?? fallbackWorkerTypeId;

  const getWarmPoolId = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.warmPoolId
      : baileysEnvironment.warmPoolId;

  const rememberRuntimeGeneration = (runtimeGeneration: unknown) => {
    const parsed = optionalRuntimeGeneration(runtimeGeneration);
    if (parsed !== undefined) {
      secureImportRuntimeGeneration = parsed;
    }
  };

  const getRuntimeGeneration = () =>
    secureImportRuntimeGeneration ??
    (module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.runtimeGeneration
      : baileysEnvironment.runtimeGeneration);

  const getRuntimeState = () => {
    if (isWarmStandby()) {
      return 'warm_standby';
    }
    if (isRuntimeActivated()) {
      return fastify.qrStreamReady ? 'active' : 'activating';
    }
    return 'inactive';
  };

  const getSessionReadiness = () =>
    module === ERouteModule.worker_wwebjs
      ? container.resolve(WwebjsHealthCheckService).verifyCurrentSession()
      : container.resolve(BaileysHealthCheckService).verifyCurrentSession();
  const getKafkaUnhealthy = () => {
    try {
      return options?.getKafkaUnhealthy?.() === true;
    } catch (err) {
      fastify.log.warn(
        { err, module },
        'Worker runtime health Kafka snapshot check failed'
      );
      return true;
    }
  };

  const buildActivationInput = (
    request: IWorkerRuntimeActivationRequestProto
  ) => ({
    worker_id: request.worker_id ?? '',
    account_id: request.account_id ?? '',
    worker_type_id: request.worker_type_id,
    runtime_generation: optionalRuntimeGeneration(request.runtime_generation),
    warm_pool_id: request.warm_pool_id,
    session_volume_name: request.session_volume_name,
    session_storage: request.session_storage,
    runtime_capability: request.runtime_capability,
    writer_epoch: request.writer_epoch,
  });

  const validateEnvironmentActivation = (
    request: IWorkerRuntimeActivationRequestProto
  ) => {
    const input = buildActivationInput(request);
    return module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.validateRuntimeActivation(input)
      : baileysEnvironment.validateRuntimeActivation(input);
  };

  const activateEnvironment = (
    request: IWorkerRuntimeActivationRequestProto
  ) => {
    const input = buildActivationInput(request);
    rememberRuntimeGeneration(input.runtime_generation);

    return module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.activateRuntime(input)
      : baileysEnvironment.activateRuntime(input);
  };

  const handleRequestConnection = (
    call: ServerUnaryCall<
      IStatusConnectionRequestProto,
      IWorkerConnectionStateProto
    >,
    callback: sendUnaryData<IWorkerConnectionStateProto>
  ) => {
    const req = call.request;
    const payload: StatusConnectionWorkerRequest = {
      worker_id: req.worker_id ?? '',
      status: (req.status as EWorkerStatus) ?? EWorkerStatus.online,
      type:
        (req.type as EBaileysConnectionType) ?? EBaileysConnectionType.qrcode,
    };
    if (req.phone_connection) {
      payload.phone_connection = req.phone_connection;
    }
    if (req.remove_session === true) {
      payload.remove_session = true;
    }
    if (req.connection_attempt_id) {
      payload.connection_attempt_id = req.connection_attempt_id;
    }
    if (req.authorized_connection_epoch) {
      payload.authorized_connection_epoch = req.authorized_connection_epoch;
    }
    if (req.debug_trace_id) {
      payload.debug_trace_id = req.debug_trace_id;
    }
    const requestRuntimeGeneration = optionalRuntimeGeneration(
      req.runtime_generation
    );
    if (requestRuntimeGeneration !== undefined) {
      payload.runtime_generation = requestRuntimeGeneration;
    }
    if (req.warm_pool_id) {
      payload.warm_pool_id = req.warm_pool_id;
    }
    if (req.qr_pending === true) {
      payload.qr_pending = true;
    }
    const accountId = getAccountId();

    void connectionLifecycleDebugService.log(
      'worker.connection_grpc.request_received',
      {
        trace_id: payload.debug_trace_id,
        layer: module,
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: getWorkerTypeId(),
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        grpc_module: module,
      }
    );
    logWorkerConnectionGrpcFlow('worker.connection_grpc.request_received', {
      trace_id: payload.debug_trace_id,
      worker_id: payload.worker_id,
      account_id: accountId,
      worker_type_id: getWorkerTypeId(),
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      type: payload.type,
      remove_session: payload.remove_session === true,
      qr_pending: payload.qr_pending === true,
      grpc_module: module,
    });

    fastify.log.info(
      {
        module,
        component: 'worker_connection_grpc_server',
        type: 'connection_status',
        event: 'worker_connection_request_received',
        worker_id: payload.worker_id,
        account_id: accountId,
        status: payload.status,
        connection_type: payload.type,
        remove_session: payload.remove_session === true,
        qr_pending: payload.qr_pending === true,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        warm_pool_id: payload.warm_pool_id,
      },
      'Worker connection request received'
    );

    connectionConsume
      .requestConnection(payload)
      .then((response) => {
        const responseState = {
          ...response,
          worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
          runtime_generation:
            response.runtime_generation ?? requestRuntimeGeneration,
          warm_pool_id: response.warm_pool_id ?? payload.warm_pool_id,
          connection_attempt_id:
            response.connection_attempt_id ?? payload.connection_attempt_id,
          authorized_connection_epoch:
            response.authorized_connection_epoch ??
            payload.authorized_connection_epoch,
          debug_trace_id: response.debug_trace_id ?? payload.debug_trace_id,
        };
        const responseWithAttempt: IWorkerConnectionStateProto =
          connectionStateToProto(responseState);
        void connectionLifecycleDebugService.log(
          'worker.connection_grpc.request_dispatched',
          {
            trace_id: payload.debug_trace_id,
            layer: module,
            worker_id: payload.worker_id,
            account_id: accountId,
            worker_type_id: responseState.worker_type_id,
            connection_attempt_id: responseState.connection_attempt_id,
            runtime_generation: responseState.runtime_generation,
            status: responseState.status,
            code: responseState.code,
            reason: responseState.reason,
            qrcode: responseState.qrcode,
            pairing_code: responseState.pairing_code,
            qr_pending: responseState.qr_pending === true,
            grpc_module: module,
          }
        );
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.request_dispatched',
          {
            trace_id: payload.debug_trace_id,
            worker_id: payload.worker_id,
            account_id: accountId,
            worker_type_id: responseState.worker_type_id,
            connection_attempt_id: responseState.connection_attempt_id,
            runtime_generation: responseState.runtime_generation,
            status: responseState.status,
            code: responseState.code,
            reason: responseState.reason,
            qrcode: responseState.qrcode,
            pairing_code: responseState.pairing_code,
            has_passkey_public_key: Boolean(responseState.passkey_public_key),
            passkey_public_key: responseState.passkey_public_key,
            has_passkey_confirmation_code: Boolean(
              responseState.passkey_confirmation_code
            ),
            passkey_confirmation_code: responseState.passkey_confirmation_code,
            qr_pending: responseState.qr_pending === true,
            grpc_module: module,
          }
        );
        fastify.log.info(
          {
            module,
            component: 'worker_connection_grpc_server',
            type: 'connection_status',
            event: 'worker_connection_request_dispatched',
            worker_id: payload.worker_id,
            account_id: accountId,
            status: payload.status,
            connection_type: payload.type,
            remove_session: payload.remove_session === true,
            request_qr_pending: payload.qr_pending === true,
            has_qr: Boolean(response.qrcode),
            connection_attempt_id:
              response.connection_attempt_id ?? payload.connection_attempt_id,
            runtime_generation:
              response.runtime_generation ?? requestRuntimeGeneration,
            warm_pool_id: response.warm_pool_id ?? payload.warm_pool_id,
            reason: response.reason,
            qr_pending: response.qr_pending === true,
          },
          'Worker connection request dispatched'
        );
        callback(null, responseWithAttempt);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        void connectionLifecycleDebugService.log(
          'worker.connection_grpc.request_error',
          {
            trace_id: payload.debug_trace_id,
            layer: module,
            worker_id: payload.worker_id,
            account_id: accountId,
            worker_type_id: getWorkerTypeId(),
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            status: payload.status,
            reason: msg,
            grpc_module: module,
          }
        );
        logWorkerConnectionGrpcFlow('worker.connection_grpc.request_error', {
          trace_id: payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: accountId,
          worker_type_id: getWorkerTypeId(),
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          status: payload.status,
          type: payload.type,
          grpc_module: module,
          reason: msg,
        });
        fastify.log.error(
          {
            err,
            module,
            component: 'worker_connection_grpc_server',
            type: 'connection_status',
            event: 'worker_connection_request_error',
            worker_id: payload.worker_id,
            account_id: accountId,
            status: payload.status,
            connection_type: payload.type,
            remove_session: payload.remove_session === true,
            qr_pending: payload.qr_pending === true,
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            warm_pool_id: payload.warm_pool_id,
          },
          'WorkerConnection gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handlePrepareProviderHandoff = (
    call: ServerUnaryCall<
      IRawPrepareProviderHandoffRequestProto,
      IPrepareProviderHandoffResponseProto
    >,
    callback: sendUnaryData<IPrepareProviderHandoffResponseProto>
  ) => {
    const raw = call.request;
    const expectedProvider: WhatsappSessionProvider =
      module === ERouteModule.worker_wwebjs ? 'wwebjs' : 'baileys';
    const sourceRevisionId = String(raw.source_revision_id ?? '').trim();
    const runtimeGeneration = optionalRuntimeGeneration(raw.runtime_generation);
    const payload: IPrepareProviderHandoffRequestProto = {
      worker_id: raw.worker_id?.trim() ?? '',
      account_id: raw.account_id?.trim() ?? '',
      handoff_id: raw.handoff_id?.trim() ?? '',
      lifecycle_operation_id: raw.lifecycle_operation_id?.trim() ?? '',
      source_provider: raw.source_provider
        ?.trim()
        .toLowerCase() as WhatsappSessionProvider,
      target_provider: raw.target_provider
        ?.trim()
        .toLowerCase() as WhatsappSessionProvider,
      source_revision_id: sourceRevisionId,
      runtime_generation: runtimeGeneration ?? 0,
      debug_trace_id: raw.debug_trace_id?.trim() || undefined,
    };
    const supportedProviders = new Set<WhatsappSessionProvider>([
      'baileys',
      'wwebjs',
      'whatsmeow',
    ]);
    const invalidReason =
      !payload.worker_id ||
      !payload.account_id ||
      !payload.handoff_id ||
      !payload.lifecycle_operation_id ||
      !/^[1-9][0-9]*$/.test(payload.source_revision_id) ||
      payload.runtime_generation <= 0
        ? 'prepare_provider_handoff_required_fields_invalid'
        : !supportedProviders.has(payload.source_provider) ||
            !supportedProviders.has(payload.target_provider) ||
            payload.source_provider !== expectedProvider ||
            payload.source_provider === payload.target_provider
          ? 'prepare_provider_handoff_provider_invalid'
          : payload.worker_id !== getWorkerId() ||
              payload.account_id !== getAccountId() ||
              payload.runtime_generation !== getRuntimeGeneration()
            ? 'prepare_provider_handoff_runtime_identity_mismatch'
            : process.env.WORKER_SESSION_STORAGE?.trim().toLowerCase() !==
                'postgres'
              ? 'prepare_provider_handoff_requires_postgres_session'
              : undefined;

    if (invalidReason) {
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: invalidReason,
          details: invalidReason,
        },
        null
      );
      return;
    }

    const startedAt = Date.now();
    logWorkerConnectionGrpcFlow(
      'worker.connection_grpc.provider_handoff.received',
      {
        trace_id: payload.debug_trace_id,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        handoff_id: payload.handoff_id,
        lifecycle_operation_id: payload.lifecycle_operation_id,
        source_provider: payload.source_provider,
        target_provider: payload.target_provider,
        source_revision_id: payload.source_revision_id,
        runtime_generation: payload.runtime_generation,
        grpc_module: module,
        grpc_method: 'PrepareProviderHandoff',
      }
    );

    phoneValidationService
      .prepareProviderHandoff(payload)
      .then((response) => {
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.provider_handoff.completed',
          {
            trace_id: payload.debug_trace_id,
            worker_id: response.worker_id,
            handoff_id: response.handoff_id,
            lifecycle_operation_id: response.lifecycle_operation_id,
            source_provider: response.provider,
            source_revision_id: response.source_revision_id,
            runtime_generation: response.runtime_generation,
            prepared: response.prepared,
            consumers_drained: response.consumers_drained,
            writes_paused: response.writes_paused,
            checkpoint_persisted: response.checkpoint_persisted,
            provider_disconnected: response.provider_disconnected,
            lease_released: response.lease_released,
            duration_ms: Date.now() - startedAt,
            grpc_module: module,
            grpc_method: 'PrepareProviderHandoff',
          }
        );
        callback(null, response);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.provider_handoff.failed',
          {
            trace_id: payload.debug_trace_id,
            worker_id: payload.worker_id,
            handoff_id: payload.handoff_id,
            lifecycle_operation_id: payload.lifecycle_operation_id,
            source_provider: payload.source_provider,
            target_provider: payload.target_provider,
            source_revision_id: payload.source_revision_id,
            runtime_generation: payload.runtime_generation,
            reason: message,
            duration_ms: Date.now() - startedAt,
            grpc_module: module,
            grpc_method: 'PrepareProviderHandoff',
          }
        );
        callback(
          { code: status.FAILED_PRECONDITION, message, details: message },
          null
        );
      });
  };

  const handlePrepareSessionStorageMigration = (
    call: ServerUnaryCall<
      IRawPrepareSessionStorageMigrationRequestProto,
      IPrepareSessionStorageMigrationResponseProto
    >,
    callback: sendUnaryData<IPrepareSessionStorageMigrationResponseProto>
  ) => {
    const raw = call.request;
    const expectedProvider =
      module === ERouteModule.worker_wwebjs ? 'wwebjs' : 'baileys';
    const payload: IPrepareSessionStorageMigrationRequestProto = {
      worker_id: raw.worker_id?.trim() ?? '',
      account_id: raw.account_id?.trim() ?? '',
      migration_id: raw.migration_id?.trim() ?? '',
      provider: raw.provider?.trim().toLowerCase() as 'baileys' | 'wwebjs',
      source_volume_name: raw.source_volume_name?.trim() ?? '',
      runtime_generation:
        optionalRuntimeGeneration(raw.runtime_generation) ?? 0,
      expected_phone: raw.expected_phone?.trim() || undefined,
      debug_trace_id: raw.debug_trace_id?.trim() || undefined,
      runtime_capability: raw.runtime_capability?.trim() ?? '',
    };
    const invalidReason =
      !payload.worker_id ||
      !payload.account_id ||
      !payload.migration_id ||
      !payload.source_volume_name ||
      !payload.runtime_capability ||
      payload.runtime_generation <= 0
        ? 'prepare_session_storage_migration_required_fields_invalid'
        : payload.provider !== expectedProvider
          ? 'prepare_session_storage_migration_provider_invalid'
          : payload.worker_id !== getWorkerId() ||
              payload.account_id !== getAccountId() ||
              payload.runtime_generation !== getRuntimeGeneration() ||
              payload.runtime_capability !==
                process.env.WORKER_RUNTIME_CAPABILITY ||
              process.env.WORKER_SESSION_STORAGE !== 'legacy_volume' ||
              process.env.SESSION_VOLUME_NAME !== payload.source_volume_name
            ? 'prepare_session_storage_migration_runtime_identity_mismatch'
            : undefined;

    if (invalidReason) {
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: invalidReason,
          details: invalidReason,
        },
        null
      );
      return;
    }

    phoneValidationService
      .prepareSessionStorageMigration(payload)
      .then((response) => callback(null, response))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        callback(
          { code: status.FAILED_PRECONDITION, message, details: message },
          null
        );
      });
  };

  const handleValidatePhone = (
    call: ServerUnaryCall<IPhoneValidationRequest, IPhoneValidationResponse>,
    callback: sendUnaryData<IPhoneValidationResponse>
  ) => {
    const req = call.request;

    if (!req.phone || !req.phone_ddi) {
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: 'Missing required fields: phone, phone_ddi',
          details: 'Missing required fields: phone, phone_ddi',
        },
        null
      );
      return;
    }

    phoneValidationService
      .validatePhone(req.phone_ddi, req.phone)
      .then((result) => {
        callback(null, {
          request_id: req.request_id ?? '',
          account_id: req.account_id ?? '',
          worker_id: req.worker_id ?? '',
          valid: result.valid,
          jid: result.jid ?? '',
          phone: result.phone ?? '',
          error: '',
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err },
          'Worker phone validation gRPC handler error'
        );
        callback(null, {
          request_id: req.request_id ?? '',
          account_id: req.account_id ?? '',
          worker_id: req.worker_id ?? '',
          valid: false,
          error: msg,
        });
      });
  };

  const handleActivateRuntime = (
    call: ServerUnaryCall<
      IWorkerRuntimeActivationRequestProto,
      IWorkerRuntimeActivationResponseProto
    >,
    callback: sendUnaryData<IWorkerRuntimeActivationResponseProto>
  ) => {
    const req = call.request;
    if (!req.worker_id || !req.account_id) {
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: 'Missing required fields: worker_id, account_id',
          details: 'Missing required fields: worker_id, account_id',
        },
        null
      );
      return;
    }

    Promise.resolve()
      .then(async () => {
        validateEnvironmentActivation(req);
        await activateWorkerRuntimeFence({
          workerId: req.worker_id ?? '',
          accountId: req.account_id ?? '',
          workerTypeId: req.worker_type_id ?? fallbackWorkerTypeId,
          generation: Number(req.runtime_generation),
          writerEpoch: req.writer_epoch ?? '',
          capability: req.runtime_capability ?? '',
        });
        const activation = activateEnvironment(req);
        const callbackResult = await options?.activateRuntime?.(fastify, req);
        return {
          alreadyActive:
            activation.alreadyActive || callbackResult?.alreadyActive === true,
        };
      })
      .then(({ alreadyActive }) => {
        fastify.log.info(
          {
            module,
            component: 'worker_connection_grpc_server',
            type: 'runtime_activation',
            event: 'worker_runtime_activated',
            worker_id: req.worker_id,
            account_id: req.account_id,
            warm_pool_id: req.warm_pool_id,
            already_active: alreadyActive,
          },
          'Worker runtime activated'
        );
        callback(null, {
          worker_id: req.worker_id,
          account_id: req.account_id,
          activated: true,
          already_active: alreadyActive,
          error: '',
        });
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          {
            err,
            module,
            component: 'worker_connection_grpc_server',
            type: 'runtime_activation',
            event: 'worker_runtime_activation_error',
            worker_id: req.worker_id,
            account_id: req.account_id,
            warm_pool_id: req.warm_pool_id,
          },
          'Worker runtime activation failed'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleRuntimeHealth = (
    call: ServerUnaryCall<
      IWorkerRuntimeHealthRequestProto,
      IWorkerRuntimeHealthResponseProto
    >,
    callback: sendUnaryData<IWorkerRuntimeHealthResponseProto>
  ) => {
    void (async () => {
      const runtimeWarmPoolId = getWarmPoolId()?.trim() ?? '';
      try {
        resolveWorkerRuntimeHealthWarmPoolIdentity(
          call.request.warm_pool_id,
          runtimeWarmPoolId
        );
        const qrStreamReady = fastify.qrStreamReady === true;
        const runtimeActivated = isRuntimeActivated();
        const warmStandby = isWarmStandby();
        const readiness = await getSessionReadiness();
        const nativeEvidence =
          phoneValidationService.getConnectionStatusHealthEvidence();
        const nativeConnectionOnline = isWhatsappConnectionOnline(
          nativeEvidence.connectionStatus
        );
        const nativeProofReady =
          nativeConnectionOnline &&
          nativeEvidence.sourceCurrent &&
          Boolean(nativeEvidence.connectionStatusSourceId) &&
          nativeEvidence.leaseProofValid;
        const hasDurableSession = phoneValidationService.hasSession();
        const kafkaHealth = resolveWorkerRuntimeKafkaHealthState({
          standby: warmStandby,
          activated: runtimeActivated,
          kafkaUnhealthy: getKafkaUnhealthy(),
        });
        const kafkaConsumersAuthorized =
          runtimeActivated &&
          !warmStandby &&
          kafkaHealth.kafkaConsumersReady &&
          isWorkerKafkaDispatchAuthorized();
        const providerSessionReady =
          readiness.session_ready === true && nativeProofReady;
        const degradedReason =
          readiness.session_ready === true && !nativeConnectionOnline
            ? 'native_connection_not_online'
            : readiness.session_ready === true &&
                (!nativeEvidence.sourceCurrent ||
                  !nativeEvidence.connectionStatusSourceId)
              ? 'native_connection_status_source_invalid'
              : readiness.session_ready === true &&
                  nativeEvidence.leaseRequired &&
                  !nativeEvidence.leaseProofValid
                ? 'session_lease_proof_unavailable'
                : providerSessionReady &&
                    kafkaHealth.kafkaConsumersReady &&
                    !kafkaConsumersAuthorized
                  ? 'awaiting_dispatch_authorization'
                  : (readiness.degraded_reason ?? '');
        callback(null, {
          worker_id: runtimeActivated ? getWorkerId() : '',
          account_id: runtimeActivated ? getAccountId() : '',
          warm_pool_id: runtimeWarmPoolId,
          standby: warmStandby,
          activated: runtimeActivated,
          ready: warmStandby || qrStreamReady,
          // A persisted provider session may be restorable before the current
          // process finishes authenticating. Keep that durable fact separate
          // from the live `authenticated` readiness signal so an orchestrator
          // does not mistake a session restore in progress for an empty
          // profile that needs a new QR code.
          has_session: hasDurableSession,
          has_qr: false,
          worker_type_id: getWorkerTypeId(),
          runtime_generation: getRuntimeGeneration(),
          runtime_state: getRuntimeState(),
          qr_stream_ready: qrStreamReady,
          // Keep raw provider readiness visible for the one online-notification
          // bootstrap that grants dispatch authorization. Every operational
          // liveness consumer must also require kafka_consumers_authorized.
          session_ready: providerSessionReady,
          can_send: readiness.can_send === true && nativeProofReady,
          can_receive_runtime:
            readiness.can_receive_runtime === true && nativeProofReady,
          authenticated: readiness.authenticated === true,
          provider_state: readiness.provider_state ?? '',
          degraded_reason: degradedReason,
          last_probe_at: readiness.last_probe_at ?? '',
          probe_latency_ms: readiness.probe_latency_ms ?? 0,
          phone: readiness.phone ?? '',
          kafka_unhealthy: kafkaHealth.kafkaUnhealthy,
          kafka_consumers_ready: kafkaHealth.kafkaConsumersReady,
          kafka_consumers_authorized: kafkaConsumersAuthorized,
          command_ingress_ready: kafkaHealth.kafkaConsumersReady,
          command_ingress_authorized: kafkaConsumersAuthorized,
          runtime_health_schema_version: 4,
          connection_status: nativeEvidence.connectionStatus,
          connection_status_source_id: nativeEvidence.connectionStatusSourceId,
          session_storage: nativeEvidence.sessionStorage,
          session_revision_id: nativeEvidence.sessionRevisionId ?? '0',
          session_storage_migration_id:
            nativeEvidence.sessionStorageMigrationId ?? '',
          error: '',
        });
      } catch (err) {
        callback(null, {
          worker_id: '',
          account_id: '',
          warm_pool_id: runtimeWarmPoolId,
          standby: false,
          activated: false,
          ready: false,
          has_session: false,
          has_qr: false,
          worker_type_id: fallbackWorkerTypeId,
          runtime_generation: 0,
          runtime_state: 'error',
          qr_stream_ready: false,
          session_ready: false,
          can_send: false,
          can_receive_runtime: false,
          authenticated: false,
          provider_state: 'error',
          degraded_reason: err instanceof Error ? err.message : String(err),
          last_probe_at: new Date().toISOString(),
          probe_latency_ms: 0,
          kafka_unhealthy: true,
          kafka_consumers_ready: false,
          kafka_consumers_authorized: false,
          command_ingress_ready: false,
          command_ingress_authorized: false,
          runtime_health_schema_version: 4,
          session_storage:
            process.env.WORKER_SESSION_STORAGE?.trim() || 'legacy_volume',
          session_revision_id: '0',
          session_storage_migration_id:
            process.env.SESSION_STORAGE_MIGRATION_ID?.trim() ?? '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };

  const handleSendPasskeyResponse = (
    call: ServerUnaryCall<
      IPasskeyResponseRequestProto,
      IWorkerConnectionStateProto
    >,
    callback: sendUnaryData<IWorkerConnectionStateProto>
  ) => {
    if (module === ERouteModule.worker_wwebjs) {
      callback(
        {
          code: status.UNIMPLEMENTED,
          message: 'Passkey pairing is not supported by worker_wwebjs',
          details: 'Passkey pairing is not supported by worker_wwebjs',
        },
        null
      );
      return;
    }

    const req = call.request;
    logWorkerConnectionGrpcFlow(
      'worker.connection_grpc.passkey_response_received',
      {
        trace_id: req.debug_trace_id,
        worker_id: req.worker_id,
        account_id: req.account_id,
        worker_type_id: getWorkerTypeId(),
        connection_attempt_id: req.connection_attempt_id,
        grpc_module: module,
        passkey_response: req.passkey_response,
      }
    );
    if (!req.worker_id || !req.account_id || !req.passkey_response) {
      logWorkerConnectionGrpcFlow(
        'worker.connection_grpc.passkey_response_invalid',
        {
          trace_id: req.debug_trace_id,
          worker_id: req.worker_id,
          account_id: req.account_id,
          worker_type_id: getWorkerTypeId(),
          connection_attempt_id: req.connection_attempt_id,
          grpc_module: module,
          has_worker_id: Boolean(req.worker_id),
          has_account_id: Boolean(req.account_id),
          has_passkey_response: Boolean(req.passkey_response),
        }
      );
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message:
            'Missing required fields: worker_id, account_id, passkey_response',
          details:
            'Missing required fields: worker_id, account_id, passkey_response',
        },
        null
      );
      return;
    }

    container
      .resolve(BaileysService)
      .sendPasskeyResponse({
        worker_id: req.worker_id,
        account_id: req.account_id,
        connection_attempt_id: req.connection_attempt_id,
        passkey_response: req.passkey_response,
        debug_trace_id: req.debug_trace_id,
      })
      .then((response) => {
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.passkey_response_dispatched',
          {
            trace_id: response.debug_trace_id ?? req.debug_trace_id,
            worker_id: req.worker_id,
            account_id: response.account_id ?? req.account_id,
            worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
            connection_attempt_id:
              response.connection_attempt_id ?? req.connection_attempt_id,
            status: response.status,
            code: response.code,
            reason: response.reason,
            has_passkey_public_key: Boolean(response.passkey_public_key),
            has_passkey_confirmation_code: Boolean(
              response.passkey_confirmation_code
            ),
            grpc_module: module,
          }
        );
        callback(
          null,
          connectionStateToProto({
            ...response,
            worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
            connection_attempt_id:
              response.connection_attempt_id ?? req.connection_attempt_id,
            debug_trace_id: response.debug_trace_id ?? req.debug_trace_id,
          })
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.passkey_response_error',
          {
            trace_id: req.debug_trace_id,
            worker_id: req.worker_id,
            account_id: req.account_id,
            worker_type_id: getWorkerTypeId(),
            connection_attempt_id: req.connection_attempt_id,
            grpc_module: module,
            reason: msg,
          }
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleConfirmPasskey = (
    call: ServerUnaryCall<
      IPasskeyConfirmationRequestProto,
      IWorkerConnectionStateProto
    >,
    callback: sendUnaryData<IWorkerConnectionStateProto>
  ) => {
    if (module === ERouteModule.worker_wwebjs) {
      callback(
        {
          code: status.UNIMPLEMENTED,
          message: 'Passkey pairing is not supported by worker_wwebjs',
          details: 'Passkey pairing is not supported by worker_wwebjs',
        },
        null
      );
      return;
    }

    const req = call.request;
    logWorkerConnectionGrpcFlow(
      'worker.connection_grpc.passkey_confirmation_received',
      {
        trace_id: req.debug_trace_id,
        worker_id: req.worker_id,
        account_id: req.account_id,
        worker_type_id: getWorkerTypeId(),
        connection_attempt_id: req.connection_attempt_id,
        grpc_module: module,
      }
    );
    if (!req.worker_id || !req.account_id) {
      logWorkerConnectionGrpcFlow(
        'worker.connection_grpc.passkey_confirmation_invalid',
        {
          trace_id: req.debug_trace_id,
          worker_id: req.worker_id,
          account_id: req.account_id,
          worker_type_id: getWorkerTypeId(),
          connection_attempt_id: req.connection_attempt_id,
          grpc_module: module,
          has_worker_id: Boolean(req.worker_id),
          has_account_id: Boolean(req.account_id),
        }
      );
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: 'Missing required fields: worker_id, account_id',
          details: 'Missing required fields: worker_id, account_id',
        },
        null
      );
      return;
    }

    container
      .resolve(BaileysService)
      .confirmPasskey({
        worker_id: req.worker_id,
        account_id: req.account_id,
        connection_attempt_id: req.connection_attempt_id,
        debug_trace_id: req.debug_trace_id,
      })
      .then((response) => {
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.passkey_confirmation_dispatched',
          {
            trace_id: response.debug_trace_id ?? req.debug_trace_id,
            worker_id: req.worker_id,
            account_id: response.account_id ?? req.account_id,
            worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
            connection_attempt_id:
              response.connection_attempt_id ?? req.connection_attempt_id,
            status: response.status,
            code: response.code,
            reason: response.reason,
            has_passkey_public_key: Boolean(response.passkey_public_key),
            has_passkey_confirmation_code: Boolean(
              response.passkey_confirmation_code
            ),
            grpc_module: module,
          }
        );
        callback(
          null,
          connectionStateToProto({
            ...response,
            worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
            connection_attempt_id:
              response.connection_attempt_id ?? req.connection_attempt_id,
            debug_trace_id: response.debug_trace_id ?? req.debug_trace_id,
          })
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.passkey_confirmation_error',
          {
            trace_id: req.debug_trace_id,
            worker_id: req.worker_id,
            account_id: req.account_id,
            worker_type_id: getWorkerTypeId(),
            connection_attempt_id: req.connection_attempt_id,
            grpc_module: module,
            reason: msg,
          }
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleImportSecureSession = (
    call: ServerUnaryCall<
      ISecureSessionImportRequestProto,
      IWorkerConnectionStateProto
    >,
    callback: sendUnaryData<IWorkerConnectionStateProto>
  ) => {
    const req = call.request;
    const requestRuntimeGeneration = optionalRuntimeGeneration(
      req.runtime_generation
    );
    const payload: ISecureConnectionImportRequest = {
      worker_id: req.worker_id ?? '',
      account_id: req.account_id ?? '',
      worker_type_id: req.worker_type_id as EWorkerType | undefined,
      connection_attempt_id: req.connection_attempt_id ?? '',
      runtime_generation: requestRuntimeGeneration,
      format_version: req.format_version ?? '',
      source: 'whatsapp_web',
      target_provider:
        req.target_provider === 'baileys' ||
        req.target_provider === 'wwebjs' ||
        req.target_provider === 'whatsmeow'
          ? req.target_provider
          : 'auto',
      payload_ref: req.payload_ref,
      payload_json: req.payload_json,
      checksum: req.checksum,
      debug_trace_id: req.debug_trace_id,
      authorized_connection_epoch: req.authorized_connection_epoch,
    };
    const startedAt = Date.now();
    rememberRuntimeGeneration(requestRuntimeGeneration);

    logWorkerConnectionGrpcFlow(
      'worker.connection_grpc.secure_import_received',
      {
        trace_id: payload.debug_trace_id,
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: getWorkerTypeId(),
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        authorized_connection_epoch_set: Boolean(
          payload.authorized_connection_epoch
        ),
        format_version: payload.format_version,
        target_provider: payload.target_provider,
        has_payload_ref: Boolean(payload.payload_ref),
        has_payload_json: Boolean(payload.payload_json),
        grpc_module: module,
      }
    );

    if (
      !payload.worker_id ||
      !payload.account_id ||
      !payload.connection_attempt_id ||
      !payload.format_version ||
      (!payload.payload_ref && !payload.payload_json)
    ) {
      logWorkerConnectionGrpcFlow(
        'worker.connection_grpc.secure_import_invalid_argument',
        {
          trace_id: payload.debug_trace_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: getWorkerTypeId(),
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          format_version: payload.format_version,
          target_provider: payload.target_provider,
          has_payload_ref: Boolean(payload.payload_ref),
          has_payload_json: Boolean(payload.payload_json),
          duration_ms: Date.now() - startedAt,
          grpc_module: module,
          grpc_method: 'ImportSecureSession',
        }
      );
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message:
            'Missing required fields: worker_id, account_id, connection_attempt_id, format_version, payload',
          details:
            'Missing required fields: worker_id, account_id, connection_attempt_id, format_version, payload',
        },
        null
      );
      return;
    }

    const service =
      module === ERouteModule.worker_wwebjs
        ? container.resolve(WwebjsService)
        : container.resolve(BaileysService);

    service
      .importSecureSession(payload)
      .then((response) => {
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.secure_import_done',
          {
            trace_id: response.debug_trace_id ?? payload.debug_trace_id,
            worker_id: response.worker_id ?? payload.worker_id,
            account_id: response.account_id ?? payload.account_id,
            worker_type_id: response.worker_type_id ?? getWorkerTypeId(),
            connection_attempt_id:
              response.connection_attempt_id ?? payload.connection_attempt_id,
            runtime_generation:
              response.runtime_generation ?? payload.runtime_generation,
            status: response.status,
            code: response.code,
            reason: response.reason,
            session_ready: response.session_ready,
            authenticated: response.authenticated,
            duration_ms: Date.now() - startedAt,
            grpc_module: module,
            grpc_method: 'ImportSecureSession',
          }
        );
        callback(
          null,
          connectionStateToProto({
            ...response,
            worker_type_id: response.worker_type_id ?? fallbackWorkerTypeId,
            connection_attempt_id:
              response.connection_attempt_id ?? payload.connection_attempt_id,
            debug_trace_id: response.debug_trace_id ?? payload.debug_trace_id,
            runtime_generation:
              response.runtime_generation ?? payload.runtime_generation,
          })
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logWorkerConnectionGrpcFlow(
          'worker.connection_grpc.secure_import_error',
          {
            trace_id: payload.debug_trace_id,
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            worker_type_id: getWorkerTypeId(),
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            duration_ms: Date.now() - startedAt,
            grpc_module: module,
            grpc_method: 'ImportSecureSession',
            reason: msg,
          }
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  grpcServer.addService(WorkerConnectionService.service, {
    RequestConnection: handleRequestConnection,
    ValidatePhone: handleValidatePhone,
    ActivateRuntime: handleActivateRuntime,
    RuntimeHealth: handleRuntimeHealth,
    SendPasskeyResponse: handleSendPasskeyResponse,
    ConfirmPasskey: handleConfirmPasskey,
    ImportSecureSession: handleImportSecureSession,
    PrepareProviderHandoff: handlePrepareProviderHandoff,
    PrepareSessionStorageMigration: handlePrepareSessionStorageMigration,
  });

  const bind = `0.0.0.0:${grpcPort}`;
  await new Promise<void>((resolve, reject) => {
    grpcServer.bindAsync(
      bind,
      ServerCredentials.createInsecure(),
      (err: Error | null) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });

  fastify.log.info({ bind }, 'WorkerConnection gRPC server started');

  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      grpcServer.tryShutdown(() => resolve());
    });
  });
};

export default fp(workerConnectionGrpcServerPlugin, {
  name: 'worker-connection-grpc-server',
});
