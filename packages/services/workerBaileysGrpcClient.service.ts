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
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';

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

const GRPC_DEADLINE_MS = 10_000;

@injectable()
export class WorkerBaileysGrpcClientService {
  private buildConnectionProtoPayload(payload: StatusConnectionWorkerRequest): {
    worker_id: string;
    status: string;
    type: string;
    phone_connection?: string;
    remove_session?: boolean;
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
    if (payload.remove_session === true) {
      (protoPayload as { remove_session?: boolean }).remove_session = true;
    }

    return protoPayload;
  }

  private getGrpcPorts(workerType?: EWorkerType): number[] {
    if (workerType === EWorkerType.wwebjs) {
      return [balanceEnvironment.workerWwebjsGrpcPort];
    }

    if (workerType === EWorkerType.whatsmeow) {
      return [balanceEnvironment.workerWhatsmeowGrpcPort];
    }

    if (workerType === EWorkerType.baileys) {
      return [balanceEnvironment.workerBaileysGrpcPort];
    }

    return [
      balanceEnvironment.workerBaileysGrpcPort,
      balanceEnvironment.workerWwebjsGrpcPort,
      balanceEnvironment.workerWhatsmeowGrpcPort,
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

  private async requestConnectionByAddress(
    address: string,
    protoPayload: {
      worker_id: string;
      status: string;
      type: string;
      phone_connection?: string;
      remove_session?: boolean;
    }
  ): Promise<void> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    await new Promise<void>((resolve, reject) => {
      (client as any).RequestConnection(
        protoPayload,
        { deadline },
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

  private async validatePhoneByAddress(
    address: string,
    payload: IPhoneValidationRequest
  ): Promise<IPhoneValidationResponse> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    return new Promise<IPhoneValidationResponse>((resolve, reject) => {
      (client as any).ValidatePhone(
        payload,
        { deadline },
        (
          err: ServiceError | null,
          response?: IPhoneValidationResponse
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }

          resolve(
            response ?? {
              request_id: payload.request_id,
              account_id: payload.account_id,
              worker_id: payload.worker_id,
              valid: false,
              error: 'Empty gRPC response',
            }
          );
        }
      );
    });
  }

  private async callWithFallback<T>(
    workerId: string,
    workerType: EWorkerType | undefined,
    callByAddress: (address: string) => Promise<T>
  ): Promise<T> {
    const ports = this.getGrpcPorts(workerType);
    let lastError: unknown;

    for (let index = 0; index < ports.length; index++) {
      const port = ports[index];
      const isLastPort = index === ports.length - 1;
      const address = `${workerId}:${port}`;

      try {
        return await callByAddress(address);
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

    throw new Error('gRPC call failed with no explicit error');
  }

  async requestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<void> {
    const protoPayload = this.buildConnectionProtoPayload(payload);

    await this.callWithFallback(workerId, workerType, (address) =>
      this.requestConnectionByAddress(address, protoPayload)
    );
  }

  async validatePhone(
    workerId: string,
    payload: IPhoneValidationRequest,
    workerType?: EWorkerType
  ): Promise<IPhoneValidationResponse> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.validatePhoneByAddress(address, payload)
    );
  }
}
