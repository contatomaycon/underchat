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
import { BaileysService } from '@core/services/baileys';
import { BaileysHealthCheckService } from '@core/services/baileys/methods/healthCheck.service';
import { WwebjsService } from '@core/services/wwebjs';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IWorkerRuntimeActivationRequestProto,
  IWorkerRuntimeActivationResponseProto,
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

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

interface IStatusConnectionRequestProto {
  worker_id?: string;
  status?: string;
  type?: string;
  phone_connection?: string;
  remove_session?: boolean;
  connection_attempt_id?: string;
  debug_trace_id?: string;
  runtime_generation?: number | string;
  warm_pool_id?: string;
}

interface WorkerConnectionGrpcOptions {
  module?: ERouteModule;
  activateRuntime?: (
    fastify: FastifyInstance,
    request: IWorkerRuntimeActivationRequestProto
  ) => Promise<{ alreadyActive?: boolean } | void>;
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

  const getRuntimeGeneration = () =>
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.runtimeGeneration
      : baileysEnvironment.runtimeGeneration;

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

  const activateEnvironment = (
    request: IWorkerRuntimeActivationRequestProto
  ) => {
    const input = {
      worker_id: request.worker_id ?? '',
      account_id: request.account_id ?? '',
      worker_type_id: request.worker_type_id,
      runtime_generation: optionalRuntimeGeneration(request.runtime_generation),
      warm_pool_id: request.warm_pool_id,
      session_volume_name: request.session_volume_name,
    };

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
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            warm_pool_id: payload.warm_pool_id,
          },
          'WorkerConnection gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
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
      try {
        const qrStreamReady = fastify.qrStreamReady === true;
        const runtimeActivated = isRuntimeActivated();
        const warmStandby = isWarmStandby();
        const readiness = await getSessionReadiness();
        callback(null, {
          worker_id: runtimeActivated ? getWorkerId() : '',
          account_id: runtimeActivated ? getAccountId() : '',
          warm_pool_id:
            call.request.warm_pool_id ?? process.env.WARM_POOL_ID ?? '',
          standby: warmStandby,
          activated: runtimeActivated,
          ready: warmStandby || qrStreamReady,
          has_session: readiness.authenticated === true,
          has_qr: false,
          worker_type_id: getWorkerTypeId(),
          runtime_generation: getRuntimeGeneration(),
          runtime_state: getRuntimeState(),
          qr_stream_ready: qrStreamReady,
          session_ready: readiness.session_ready === true,
          can_send: readiness.can_send === true,
          can_receive_runtime: readiness.can_receive_runtime === true,
          authenticated: readiness.authenticated === true,
          provider_state: readiness.provider_state ?? '',
          degraded_reason: readiness.degraded_reason ?? '',
          last_probe_at: readiness.last_probe_at ?? '',
          probe_latency_ms: readiness.probe_latency_ms ?? 0,
          phone: readiness.phone ?? '',
          error: '',
        });
      } catch (err) {
        callback(null, {
          worker_id: '',
          account_id: '',
          warm_pool_id:
            call.request.warm_pool_id ?? process.env.WARM_POOL_ID ?? '',
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
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  };

  grpcServer.addService(WorkerConnectionService.service, {
    RequestConnection: handleRequestConnection,
    ValidatePhone: handleValidatePhone,
    ActivateRuntime: handleActivateRuntime,
    RuntimeHealth: handleRuntimeHealth,
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
