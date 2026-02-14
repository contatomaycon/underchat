import { injectable } from 'tsyringe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  ServiceError,
  status,
} from '@grpc/grpc-js';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { balanceEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  private buildProtoPayload(payload: StatusConnectionWorkerRequest): {
    worker_id: string;
    status: string;
    type: string;
    phone_connection?: string;
  } {
    const protoPayload = {
      worker_id: payload.worker_id,
      status: payload.status,
      type: payload.type,
    };
    if (payload.phone_connection) {
      (protoPayload as Record<string, string>).phone_connection =
        payload.phone_connection;
    }

    return protoPayload;
  }

  private getGrpcPorts(workerType?: EWorkerType): number[] {
    if (workerType === EWorkerType.wwebjs) {
      return [balanceEnvironment.workerWwebjsGrpcPort];
    }

    if (workerType === EWorkerType.baileys) {
      return [balanceEnvironment.workerBaileysGrpcPort];
    }

    return [
      balanceEnvironment.workerBaileysGrpcPort,
      balanceEnvironment.workerWwebjsGrpcPort,
    ];
  }

  private isRetryableConnectionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const grpcError = error as ServiceError;
    const details = (grpcError.details ?? '').toLowerCase();

    return (
      grpcError.code === status.UNAVAILABLE ||
      grpcError.code === status.DEADLINE_EXCEEDED ||
      details.includes('econnrefused') ||
      details.includes('no connection established') ||
      details.includes('name resolution') ||
      details.includes('enotfound')
    );
  }

  private async requestByAddress(
    address: string,
    protoPayload: {
      worker_id: string;
      status: string;
      type: string;
      phone_connection?: string;
    }
  ): Promise<void> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );

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

  async requestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<void> {
    const protoPayload = this.buildProtoPayload(payload);
    const ports = this.getGrpcPorts(workerType);
    let lastError: unknown;

    for (let index = 0; index < ports.length; index++) {
      const port = ports[index];
      const isLastPort = index === ports.length - 1;

      try {
        await this.requestByAddress(`${workerId}:${port}`, protoPayload);
        return;
      } catch (error) {
        lastError = error;
        if (isLastPort || !this.isRetryableConnectionError(error)) {
          throw error;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  }
}
