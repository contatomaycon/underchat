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
import {
  protoToWorkerPayload,
  protoToStatusConnectionRequest,
} from '@core/common/functions/workerCommandProtoMapper';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { IChangeConnectionStatusRequestProto } from '@core/common/interfaces/IChangeConnectionStatusRequestProto';
import { INotifyWorkerStatusRequestProto } from '@core/common/interfaces/INotifyWorkerStatusRequestProto';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';

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
  const grpcServer = new Server();

  const handleUnary = (
    call: ServerUnaryCall<IWorkerPayloadProto, unknown>,
    callback: sendUnaryData<unknown>,
    action: 'create' | 'delete' | 'recreate'
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

    handler
      .handle(payload)
      .then(() => {
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error({ err, action }, 'WorkerCommand gRPC handler error');
        callback({ code: status.INTERNAL, message: msg, details: msg }, null);
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

    handler
      .handleChangeConnectionStatus(payload, req.account_id)
      .then(() => {
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

    handler
      .notifyWorkerStatus(req)
      .then(() => {
        callback(null, {});
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
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
    ChangeConnectionStatus: handleChangeConnectionStatus,
    NotifyWorkerStatus: handleNotifyWorkerStatus,
    ResolveIncomingCallAction: handleResolveIncomingCallAction,
    ValidatePhone: handleValidatePhone,
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
