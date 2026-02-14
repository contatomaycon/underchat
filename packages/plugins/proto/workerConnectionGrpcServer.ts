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
  const grpcPort =
    module === ERouteModule.worker_wwebjs
      ? wwebjsEnvironment.grpcPort
      : baileysEnvironment.grpcPort;
  const grpcServer = new Server();

  const handleRequestConnection = (
    call: ServerUnaryCall<IStatusConnectionRequestProto, unknown>,
    callback: sendUnaryData<unknown>
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

    try {
      connectionConsume.requestConnection(payload);
      callback(null, {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error({ err }, 'WorkerConnection gRPC handler error');
      callback({ code: status.INTERNAL, message: msg, details: msg }, null);
    }
  };

  grpcServer.addService(WorkerConnectionService.service, {
    RequestConnection: handleRequestConnection,
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
