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
import {
  baileysEnvironment,
  wwebjsEnvironment,
} from '@core/config/environments';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { BaileysService } from '@core/services/baileys';
import { WwebjsService } from '@core/services/wwebjs';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
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
  'worker_connection.proto'
);

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
}

interface WorkerConnectionGrpcOptions {
  module?: ERouteModule;
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
  const grpcPort =
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.grpcPort
      : baileysEnvironment.grpcPort;
  const accountId =
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.wwebjsAccountId
      : baileysEnvironment.baileysAccountId;
  const sourceProvider =
    module === ERouteModule.worker_wwebjs ? 'wwebjs' : 'baileys';
  const grpcServer = new Server();

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
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: payload.worker_id,
      channel_id: payload.worker_id,
      worker_type: sourceProvider,
      source_provider: sourceProvider,
      connection_type: payload.type,
      connection_action:
        payload.status === EWorkerStatus.online
          ? 'request_connection'
          : 'change_status',
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
      },
      'Worker connection request received'
    );

    runWithGrpcConnectionContext(call.metadata, contextData, () => {
      recordConnectionLifecycle({
        stage: 'connection.worker.grpc.request_received',
        decision: 'worker_connection_request',
        outcome: 'received',
        grpc_method: 'RequestConnection',
        status: payload.status,
        connection_type: payload.type,
        remove_session: payload.remove_session === true,
      });

      connectionConsume
        .requestConnection(payload)
        .then((response) => {
          const responseWithAttempt: IWorkerConnectionStateProto =
            connectionStateToProto({
              ...response,
              connection_attempt_id:
                response.connection_attempt_id ?? payload.connection_attempt_id,
            });
          recordConnectionLifecycle({
            stage: 'connection.worker.grpc.request_success',
            decision: 'worker_connection_request',
            outcome: 'success',
            grpc_method: 'RequestConnection',
            status: response.status,
            code: response.code,
            qrcode: response.qrcode,
            pairing_code: response.pairing_code,
            has_qr: Boolean(response.qrcode),
            has_pairing_code: Boolean(response.pairing_code),
          });
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
            },
            'Worker connection request dispatched'
          );
          callback(null, responseWithAttempt);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          recordConnectionLifecycle({
            stage: 'connection.worker.grpc.request_error',
            decision: 'worker_connection_request',
            outcome: 'error',
            reason: 'handler_error',
            level: 'error',
            grpc_method: 'RequestConnection',
            status: payload.status,
            connection_type: payload.type,
            error: msg,
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
            },
            'WorkerConnection gRPC handler error'
          );
          callback({ code: status.INTERNAL, message: msg, details: msg }, null);
        });
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

  grpcServer.addService(WorkerConnectionService.service, {
    RequestConnection: handleRequestConnection,
    ValidatePhone: handleValidatePhone,
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
