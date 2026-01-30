import { injectable } from 'tsyringe';
import path from 'path';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  ServiceError,
} from '@grpc/grpc-js';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { balanceEnvironment } from '@core/config/environments';

const protoPath = path.join(
  __dirname,
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
const WorkerConnectionClient = (protoDescriptor as any).worker_connection
  ?.WorkerConnection;

if (!WorkerConnectionClient) {
  throw new Error('WorkerConnection client not found in proto');
}

@injectable()
export class WorkerBaileysGrpcClientService {
  async requestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest
  ): Promise<void> {
    const address = `${workerId}:${balanceEnvironment.workerBaileysGrpcPort}`;
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );

    const protoPayload = {
      worker_id: payload.worker_id,
      status: payload.status,
      type: payload.type,
    };
    if (payload.phone_connection) {
      (protoPayload as Record<string, string>).phone_connection =
        payload.phone_connection;
    }

    await new Promise<void>((resolve, reject) => {
      (client as any).RequestConnection(
        protoPayload,
        (err: ServiceError | null) => {
          client.close();
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }
}
