import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import path from 'path';
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
import { baileysEnvironment } from '@core/config/environments';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';
import { BaileysService } from '@core/services/baileys';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';

const protoPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
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

const workerConnectionGrpcServerPlugin: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  const connectionConsume = container.resolve(WorkerConnectionStatusConsume);
  const baileysService = container.resolve(BaileysService);
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

  const bind = `0.0.0.0:${baileysEnvironment.grpcPort}`;
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

  grpcServer.start();
  fastify.log.info({ bind }, 'WorkerConnection gRPC server started');

  fastify.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      grpcServer.tryShutdown(() => resolve());
    });
  });

  if (!baileysService.isConnected() && !baileysService.hasSession()) {
    const bootstrapPayload: StatusConnectionWorkerRequest = {
      worker_id: baileysEnvironment.baileysWorkerId,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
    };
    connectionConsume.requestConnection(bootstrapPayload);
  }
};

export default fp(workerConnectionGrpcServerPlugin, {
  name: 'worker-connection-grpc-server',
});
