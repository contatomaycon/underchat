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
import { balanceEnvironment } from '@core/config/environments';
import { WorkerCommandHandlerService } from '@core/services/workerCommandHandler.service';
import {
  protoToWorkerPayload,
  protoToStatusConnectionRequest,
} from '@core/common/functions/workerCommandProtoMapper';
import {
  WORKER_RECREATE_SERVER_SLOT_KEY_METADATA,
  WORKER_RECREATE_SERVER_SLOT_TOKEN_METADATA,
} from '@core/common/functions/workerRecreateServerSlotMetadata';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { IChangeConnectionStatusRequestProto } from '@core/common/interfaces/IChangeConnectionStatusRequestProto';
import { INotifyWorkerStatusRequestProto } from '@core/common/interfaces/INotifyWorkerStatusRequestProto';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  ISecureConnectionImportRequest,
  SecureConnectionTargetProvider,
} from '@core/common/interfaces/ISecureConnectionSession';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';

const protoPath = resolveProtoPath('worker_command.proto');

const packageDefinition = loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = loadPackageDefinition(packageDefinition);
const workerCommandProto = (protoDescriptor as any).worker_command;
if (!workerCommandProto || !workerCommandProto.WorkerCommand) {
  throw new Error('WorkerCommand service not found in proto');
}

const WorkerCommandService = workerCommandProto.WorkerCommand;

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
}

function optionalProtoNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
  }

  return undefined;
}

function normalizeSecureSessionImportRequest(
  input: ISecureSessionImportRequestProto
): ISecureConnectionImportRequest {
  return {
    worker_id: input.worker_id ?? '',
    account_id: input.account_id ?? '',
    worker_type_id: input.worker_type_id as EWorkerType | undefined,
    connection_attempt_id: input.connection_attempt_id ?? '',
    runtime_generation: optionalProtoNumber(input.runtime_generation),
    format_version: input.format_version ?? '',
    source: input.source as 'whatsapp_web',
    target_provider: (input.target_provider ||
      'auto') as SecureConnectionTargetProvider,
    payload_ref: input.payload_ref || undefined,
    payload_json: input.payload_json || undefined,
    checksum: input.checksum || undefined,
    debug_trace_id: input.debug_trace_id || undefined,
  };
}

function getMetadataString(
  call: ServerUnaryCall<unknown, unknown>,
  key: string
): string | undefined {
  const value = call.metadata.get(key)[0];

  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();
    return text || undefined;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    return text || undefined;
  }

  return undefined;
}

const workerGrpcServerPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  const handler = container.resolve(WorkerCommandHandlerService);
  const connectionLifecycleDebugService = container.resolve(
    ConnectionLifecycleDebugService
  );
  const grpcServer = new Server();

  const handleUnary = (
    call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
    callback: sendUnaryData<unknown>,
    action: 'create' | 'delete' | 'recreate' | 'cleanup'
  ) => {
    const req = call.request;
    const raw = { ...req, action };
    let payload;
    try {
      payload = protoToWorkerPayload(raw);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: e.message,
          details: e.message,
        },
        null
      );
      return;
    }
    const recreateServerSlotKey = getMetadataString(
      call,
      WORKER_RECREATE_SERVER_SLOT_KEY_METADATA
    );
    const recreateServerSlotToken = getMetadataString(
      call,
      WORKER_RECREATE_SERVER_SLOT_TOKEN_METADATA
    );
    if (recreateServerSlotKey && recreateServerSlotToken) {
      payload.recreate_server_slot_key = recreateServerSlotKey;
      payload.recreate_server_slot_token = recreateServerSlotToken;
    }

    void connectionLifecycleDebugService.log('service.command_grpc.received', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      lifecycle_operation_id: payload.lifecycle_operation_id,
      action,
    });

    const handleError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      void connectionLifecycleDebugService.log('service.command_grpc.error', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.lifecycle_operation_id,
        action,
        reason: msg,
      });
      fastify.log.error({ err, action }, 'WorkerCommand gRPC handler error');
      return { code: status.INTERNAL, message: msg, details: msg };
    };

    if (action === 'create' || action === 'recreate') {
      void handler.handle(payload).catch(handleError);
      callback(null, {});
      return;
    }

    handler
      .handle(payload)
      .then(() => {
        void connectionLifecycleDebugService.log('service.command_grpc.done', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: payload.worker_type_id,
          lifecycle_operation_id: payload.lifecycle_operation_id,
          action,
        });
        callback(null, {});
      })
      .catch((err) => {
        callback(handleError(err), null);
      });
  };

  const handleChangeConnectionStatus = (
    call: ServerUnaryCall<IChangeConnectionStatusRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    const req = call.request;
    let payload;
    try {
      payload = protoToStatusConnectionRequest(req);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message: e.message,
          details: e.message,
        },
        null
      );
      return;
    }

    void connectionLifecycleDebugService.log(
      'service.command_grpc.change_connection_status_received',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: req.account_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      }
    );

    handler
      .handleChangeConnectionStatus(payload, req.account_id)
      .then(() => {
        void connectionLifecycleDebugService.log(
          'service.command_grpc.change_connection_status_done',
          {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: payload.worker_id,
            account_id: req.account_id,
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            status: payload.status,
          }
        );
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: req.worker_id },
          'ChangeConnectionStatus gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleNotifyWorkerStatus = (
    call: ServerUnaryCall<INotifyWorkerStatusRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    const req = call.request;

    void connectionLifecycleDebugService.log(
      'service.command_grpc.notify_status_received',
      {
        trace_id: req.debug_trace_id,
        layer: 'service',
        worker_id: req.worker_id,
        account_id: req.account_id,
        worker_type_id: req.worker_type_id,
        connection_attempt_id: req.connection_attempt_id,
        runtime_generation: req.runtime_generation,
        status: req.status,
        code: req.code,
        qrcode: req.qrcode,
        pairing_code: req.pairing_code,
      }
    );
    logLocalConnectionStatus('service.command_grpc.notify_status_received', {
      layer: 'service.grpc',
      worker_id: req.worker_id,
      account_id: req.account_id,
      worker_type_id: req.worker_type_id,
      worker_status_id: req.worker_status_id,
      status: req.status,
      code: req.code,
      session_ready: req.session_ready,
      can_send: req.can_send,
      can_receive_runtime: req.can_receive_runtime,
      authenticated: req.authenticated,
      provider_state: req.provider_state,
      degraded_reason: req.degraded_reason,
      reason: req.reason,
      phone: req.phone,
      connection_attempt_id: req.connection_attempt_id,
      runtime_generation: req.runtime_generation,
      qrcode: req.qrcode,
      pairing_code: req.pairing_code,
    });

    handler
      .notifyWorkerStatus(req)
      .then(() => {
        void connectionLifecycleDebugService.log(
          'service.command_grpc.notify_status_done',
          {
            trace_id: req.debug_trace_id,
            layer: 'service',
            worker_id: req.worker_id,
            account_id: req.account_id,
            worker_type_id: req.worker_type_id,
            connection_attempt_id: req.connection_attempt_id,
            runtime_generation: req.runtime_generation,
            status: req.status,
            code: req.code,
          }
        );
        logLocalConnectionStatus('service.command_grpc.notify_status_done', {
          layer: 'service.grpc',
          worker_id: req.worker_id,
          account_id: req.account_id,
          worker_type_id: req.worker_type_id,
          worker_status_id: req.worker_status_id,
          status: req.status,
          code: req.code,
          session_ready: req.session_ready,
          phone: req.phone,
          connection_attempt_id: req.connection_attempt_id,
          runtime_generation: req.runtime_generation,
        });
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logLocalConnectionStatus('service.command_grpc.notify_status_error', {
          layer: 'service.grpc',
          worker_id: req.worker_id,
          account_id: req.account_id,
          worker_type_id: req.worker_type_id,
          worker_status_id: req.worker_status_id,
          status: req.status,
          code: req.code,
          session_ready: req.session_ready,
          phone: req.phone,
          connection_attempt_id: req.connection_attempt_id,
          runtime_generation: req.runtime_generation,
          reason: msg,
        });
        fastify.log.error(
          { err, workerId: req.worker_id },
          'NotifyWorkerStatus gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleResolveIncomingCallAction = (
    call: ServerUnaryCall<
      IResolveIncomingCallActionRequestProto,
      IResolveIncomingCallActionResponseProto
    >,
    callback: sendUnaryData<IResolveIncomingCallActionResponseProto>
  ) => {
    const req = call.request;

    handler
      .resolveIncomingCallAction(req)
      .then((response) => {
        callback(null, response);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: req.worker_id },
          'ResolveIncomingCallAction gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleRequestWorkerSelfHealing = (
    call: ServerUnaryCall<IWorkerSelfHealingRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    const req = call.request;

    logLocalConnectionStatus('service.command_grpc.self_heal_received', {
      layer: 'service.grpc',
      worker_id: req.worker_id,
      account_id: req.account_id,
      worker_type_id: req.worker_type_id,
      source: req.source,
      reason: req.reason,
      provider_state: req.provider_state,
      degraded_reason: req.degraded_reason,
      kafka_unhealthy: req.kafka_unhealthy,
      runtime_generation: req.runtime_generation,
      recovery_window_seconds: req.recovery_window_seconds,
    });

    handler
      .requestWorkerSelfHealing(req)
      .then(() => {
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: req.worker_id },
          'RequestWorkerSelfHealing gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleRegisterS3BackupFallbackUpload = (
    call: ServerUnaryCall<IRegisterS3BackupFallbackUploadRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    const req = call.request;

    handler
      .registerS3BackupFallbackUpload(req)
      .then(() => {
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          {
            err,
            accountId: req.account_id,
            objectKey: req.object_key,
          },
          'RegisterS3BackupFallbackUpload gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleGetTypingSimulationConfig = (
    call: ServerUnaryCall<
      IGetTypingSimulationConfigRequestProto,
      IGetTypingSimulationConfigResponseProto
    >,
    callback: sendUnaryData<IGetTypingSimulationConfigResponseProto>
  ) => {
    const req = call.request;

    handler
      .getTypingSimulationConfig(req)
      .then((response) => {
        callback(null, response);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: req.worker_id },
          'GetTypingSimulationConfig gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleValidatePhone = (
    call: ServerUnaryCall<IPhoneValidationRequest, IPhoneValidationResponse>,
    callback: sendUnaryData<IPhoneValidationResponse>
  ) => {
    const req = call.request;

    if (!req.worker_id || !req.account_id || !req.phone || !req.phone_ddi) {
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message:
            'Missing required fields: worker_id, account_id, phone, phone_ddi',
          details:
            'Missing required fields: worker_id, account_id, phone, phone_ddi',
        },
        null
      );
      return;
    }

    handler
      .validatePhone(req)
      .then((response) => {
        callback(null, response);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: req.worker_id },
          'ValidatePhone gRPC handler error'
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

    if (
      !req.worker_id ||
      !req.account_id ||
      !req.connection_attempt_id ||
      !req.format_version ||
      !req.source ||
      !req.target_provider
    ) {
      const message =
        'Missing required fields: worker_id, account_id, connection_attempt_id, format_version, source, target_provider';
      callback(
        {
          code: status.INVALID_ARGUMENT,
          message,
          details: message,
        },
        null
      );
      return;
    }

    const payload = normalizeSecureSessionImportRequest(req);
    logLocalConnectionStatus('service.command_grpc.secure_import_received', {
      layer: 'service.grpc',
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      target_provider: payload.target_provider,
      has_payload_ref: Boolean(payload.payload_ref),
      has_payload_json: Boolean(payload.payload_json),
    });

    handler
      .importSecureSession(payload)
      .then((response) => {
        logLocalConnectionStatus('service.command_grpc.secure_import_done', {
          layer: 'service.grpc',
          worker_id: response.worker_id || payload.worker_id,
          account_id: response.account_id || payload.account_id,
          worker_type_id: response.worker_type_id ?? payload.worker_type_id,
          connection_attempt_id:
            response.connection_attempt_id ?? payload.connection_attempt_id,
          runtime_generation:
            response.runtime_generation ?? payload.runtime_generation,
          status: response.status,
          code: response.code,
          reason: response.reason,
          session_ready: response.session_ready,
          authenticated: response.authenticated,
        });
        callback(null, connectionStateToProto(response));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, workerId: payload.worker_id },
          'ImportSecureSession gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleCreateWarmWorker = (
    call: ServerUnaryCall<
      ICreateWarmWorkerRequestProto,
      IWarmWorkerCommandResponseProto
    >,
    callback: sendUnaryData<IWarmWorkerCommandResponseProto>
  ) => {
    handler
      .createWarmWorker(call.request)
      .then((response) => {
        callback(null, response);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, warmPoolId: call.request.warm_pool_id },
          'CreateWarmWorker gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleDeleteWarmWorker = (
    call: ServerUnaryCall<IDeleteWarmWorkerRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    handler
      .deleteWarmWorker(call.request)
      .then(() => {
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          { err, warmPoolId: call.request.warm_pool_id },
          'DeleteWarmWorker gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  const handleActivateWarmWorker = (
    call: ServerUnaryCall<
      IActivateWarmWorkerRequestProto,
      IWarmWorkerCommandResponseProto
    >,
    callback: sendUnaryData<IWarmWorkerCommandResponseProto>
  ) => {
    const req = call.request;

    handler
      .activateWarmWorker(req)
      .then((response) => {
        callback(null, response);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(
          {
            err,
            workerId: req.worker_id,
            warmPoolId: req.warm_pool_id,
          },
          'ActivateWarmWorker gRPC handler error'
        );
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
      });
  };

  grpcServer.addService(WorkerCommandService.service, {
    CreateWorker: (
      call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
      cb: sendUnaryData<unknown>
    ) => handleUnary(call, cb, 'create'),
    DeleteWorker: (
      call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
      cb: sendUnaryData<unknown>
    ) => handleUnary(call, cb, 'delete'),
    RecreateWorker: (
      call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
      cb: sendUnaryData<unknown>
    ) => handleUnary(call, cb, 'recreate'),
    CleanupWorker: (
      call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
      cb: sendUnaryData<unknown>
    ) => handleUnary(call, cb, 'cleanup'),
    ChangeConnectionStatus: handleChangeConnectionStatus,
    NotifyWorkerStatus: handleNotifyWorkerStatus,
    RequestWorkerSelfHealing: handleRequestWorkerSelfHealing,
    ResolveIncomingCallAction: handleResolveIncomingCallAction,
    GetTypingSimulationConfig: handleGetTypingSimulationConfig,
    RegisterS3BackupFallbackUpload: handleRegisterS3BackupFallbackUpload,
    ValidatePhone: handleValidatePhone,
    ImportSecureSession: handleImportSecureSession,
    CreateWarmWorker: handleCreateWarmWorker,
    DeleteWarmWorker: handleDeleteWarmWorker,
    ActivateWarmWorker: handleActivateWarmWorker,
  });

  const port = balanceEnvironment.grpcPort;
  const bind = `0.0.0.0:${port}`;

  await new Promise<void>((resolve, reject) => {
    grpcServer.bindAsync(bind, ServerCredentials.createInsecure(), (err) => {
      if (err) {
        reject(err);
        return;
      }
      fastify.log.info({ bind }, 'WorkerCommand gRPC server started');
      resolve();
    });
  });

  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      grpcServer.tryShutdown((e) => {
        if (e)
          fastify.log.warn({ err: e }, 'WorkerCommand gRPC shutdown warning');
        resolve();
      });
    });
  });
};

export default fp(workerGrpcServerPlugin, { name: 'worker-grpc-server' });
