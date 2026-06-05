import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import {
  protoToWorkerPayload,
  protoToStatusConnectionRequest,
} from '@core/common/functions/workerCommandProtoMapper';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { IChangeConnectionStatusRequestProto } from '@core/common/interfaces/IChangeConnectionStatusRequestProto';
import { INotifyWorkerStatusRequestProto } from '@core/common/interfaces/INotifyWorkerStatusRequestProto';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithGrpcConnectionContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protoPath = path.join(
  __dirname,
  '..',
  '..',
  'proto',
  'worker_command.proto'
);

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

const workerGrpcServerPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  const handler = container.resolve(WorkerCommandHandlerService);
  const connectionQrCodeRequester = container.resolve(
    WorkerConnectionQrCodeRequesterUseCase
  );
  const grpcServer = new Server();
  const translateConnectionQrCodeError = ((key: string) => key) as never;

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

    const handleError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
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
    const contextData = buildConnectionLifecycleContext({
      account_id: req.account_id,
      worker_id: req.worker_id,
      channel_id: req.worker_id,
      source_provider: 'balancer',
      connection_type: req.type,
      connection_action: 'change_status',
    });
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

    runWithGrpcConnectionContext(call.metadata, contextData, () => {
      recordConnectionLifecycle({
        stage: 'connection.balancer.worker_command_grpc.change_status_received',
        decision: 'grpc_change_connection_status',
        outcome: 'received',
        grpc_method: 'ChangeConnectionStatus',
        status: payload.status,
        connection_type: payload.type,
      });

      handler
        .handleChangeConnectionStatus(payload, req.account_id)
        .then(() => {
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.change_status_success',
            decision: 'grpc_change_connection_status',
            outcome: 'success',
            grpc_method: 'ChangeConnectionStatus',
            status: payload.status,
            connection_type: payload.type,
          });
          callback(null, {});
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.change_status_error',
            decision: 'grpc_change_connection_status',
            outcome: 'error',
            reason: 'handler_error',
            level: 'error',
            grpc_method: 'ChangeConnectionStatus',
            status: payload.status,
            connection_type: payload.type,
            error: msg,
          });
          fastify.log.error(
            { err, workerId: req.worker_id },
            'ChangeConnectionStatus gRPC handler error'
          );
          callback({ code: status.INTERNAL, message: msg, details: msg }, null);
        });
    });
  };

  const handleRequestConnectionQrCode = (
    call: ServerUnaryCall<
      IChangeConnectionStatusRequestProto,
      IWorkerConnectionStateProto
    >,
    callback: sendUnaryData<IWorkerConnectionStateProto>
  ) => {
    const req = call.request;
    const contextData = buildConnectionLifecycleContext({
      account_id: req.account_id,
      worker_id: req.worker_id,
      channel_id: req.worker_id,
      source_provider: 'balancer',
      connection_type: req.type,
      connection_action: 'request_qrcode',
    });
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

    runWithGrpcConnectionContext(call.metadata, contextData, () => {
      recordConnectionLifecycle({
        stage: 'connection.balancer.worker_command_grpc.qrcode_received',
        decision: 'grpc_request_connection_qrcode',
        outcome: 'received',
        grpc_method: 'RequestConnectionQrCode',
        status: payload.status,
        connection_type: payload.type,
        connection_attempt_id: payload.connection_attempt_id,
        connection_lifecycle_id: payload.connection_lifecycle_id,
        runtime_generation: payload.runtime_generation,
        warm_pool_id: payload.warm_pool_id,
        deadline_ms: payload.qr_request_deadline_ms,
      });

      connectionQrCodeRequester
        .execute(
          translateConnectionQrCodeError,
          req.account_id ?? '',
          payload.worker_id,
          'manager'
        )
        .then((response) => {
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_command_grpc.qrcode_success',
            decision: 'grpc_request_connection_qrcode',
            outcome: 'success',
            grpc_method: 'RequestConnectionQrCode',
            status: response.status,
            code: response.code,
            qrcode: response.qrcode,
            pairing_code: response.pairing_code,
            has_qr: Boolean(response.qrcode),
            has_pairing_code: Boolean(response.pairing_code),
            connection_attempt_id:
              response.connection_attempt_id ?? payload.connection_attempt_id,
            runtime_generation:
              response.runtime_generation ?? payload.runtime_generation,
            warm_pool_id: response.warm_pool_id ?? payload.warm_pool_id,
            container_id: response.container_id,
            reason: response.reason,
            qr_pending: response.qr_pending === true,
            time_to_first_qr_ms: response.time_to_first_qr_ms,
          });
          callback(null, connectionStateToProto(response));
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          recordConnectionLifecycle({
            stage: 'connection.balancer.worker_command_grpc.qrcode_error',
            decision: 'grpc_request_connection_qrcode',
            outcome: 'error',
            reason: 'handler_error',
            level: 'error',
            grpc_method: 'RequestConnectionQrCode',
            status: payload.status,
            connection_type: payload.type,
            error: msg,
            connection_attempt_id: payload.connection_attempt_id,
            runtime_generation: payload.runtime_generation,
            warm_pool_id: payload.warm_pool_id,
          });
          fastify.log.error(
            { err, workerId: req.worker_id },
            'RequestConnectionQrCode gRPC handler error'
          );
          callback({ code: status.INTERNAL, message: msg, details: msg }, null);
        });
    });
  };

  const handleNotifyWorkerStatus = (
    call: ServerUnaryCall<INotifyWorkerStatusRequestProto, unknown>,
    callback: sendUnaryData<unknown>
  ) => {
    const req = call.request;
    const contextData = buildConnectionLifecycleContext({
      account_id: req.account_id,
      worker_id: req.worker_id,
      channel_id: req.worker_id,
      source_provider: 'balancer',
      connection_action: 'notify_worker_status',
    });

    runWithGrpcConnectionContext(call.metadata, contextData, () => {
      recordConnectionLifecycle({
        stage: 'connection.balancer.worker_command_grpc.notify_status_received',
        decision: 'notify_worker_status',
        outcome: 'received',
        grpc_method: 'NotifyWorkerStatus',
        worker_status_id: req.worker_status_id,
        connection_attempt_id: req.connection_attempt_id,
        has_phone: Boolean(req.phone),
        disconnected_user: req.disconnected_user === true,
      });

      handler
        .notifyWorkerStatus(req)
        .then(() => {
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.notify_status_success',
            decision: 'notify_worker_status',
            outcome: 'success',
            grpc_method: 'NotifyWorkerStatus',
            worker_status_id: req.worker_status_id,
            connection_attempt_id: req.connection_attempt_id,
          });
          callback(null, {});
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.notify_status_error',
            decision: 'notify_worker_status',
            outcome: 'error',
            reason: 'handler_error',
            level: 'error',
            grpc_method: 'NotifyWorkerStatus',
            worker_status_id: req.worker_status_id,
            error: msg,
          });
          fastify.log.error(
            { err, workerId: req.worker_id },
            'NotifyWorkerStatus gRPC handler error'
          );
          callback({ code: status.INTERNAL, message: msg, details: msg }, null);
        });
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
    const contextData = buildConnectionLifecycleContext({
      account_id: req.account_id,
      worker_id: req.worker_id,
      channel_id: req.worker_id,
      worker_type: req.worker_type_id,
      source_provider: 'balancer',
      connection_action: 'activate_warm_worker',
    });

    runWithGrpcConnectionContext(call.metadata, contextData, () => {
      recordConnectionLifecycle({
        stage: 'connection.balancer.worker_command_grpc.activate_warm_received',
        decision: 'grpc_activate_warm_worker',
        outcome: 'received',
        grpc_method: 'ActivateWarmWorker',
        server_id: req.server_id,
        worker_type: req.worker_type_id,
        warm_pool_id: req.warm_pool_id,
        lifecycle_operation_id: req.lifecycle_operation_id,
      });

      handler
        .activateWarmWorker(req)
        .then((response) => {
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.activate_warm_success',
            decision: 'grpc_activate_warm_worker',
            outcome: 'success',
            grpc_method: 'ActivateWarmWorker',
            server_id: req.server_id,
            worker_type: req.worker_type_id,
            warm_pool_id: req.warm_pool_id,
          });
          callback(null, response);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          recordConnectionLifecycle({
            stage:
              'connection.balancer.worker_command_grpc.activate_warm_error',
            decision: 'grpc_activate_warm_worker',
            outcome: 'error',
            reason: 'handler_error',
            level: 'error',
            grpc_method: 'ActivateWarmWorker',
            server_id: req.server_id,
            worker_type: req.worker_type_id,
            warm_pool_id: req.warm_pool_id,
            error: msg,
          });
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
    RequestConnectionQrCode: handleRequestConnectionQrCode,
    NotifyWorkerStatus: handleNotifyWorkerStatus,
    ResolveIncomingCallAction: handleResolveIncomingCallAction,
    GetTypingSimulationConfig: handleGetTypingSimulationConfig,
    RegisterS3BackupFallbackUpload: handleRegisterS3BackupFallbackUpload,
    ValidatePhone: handleValidatePhone,
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
