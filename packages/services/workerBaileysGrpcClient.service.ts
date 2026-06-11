import { injectable } from 'tsyringe';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  Metadata,
  ServiceError,
  status,
} from '@grpc/grpc-js';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { balanceEnvironment } from '@core/config/environments';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { protoToConnectionState } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IWorkerRuntimeActivationRequestProto,
  IWorkerRuntimeActivationResponseProto,
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';

const protoPath = resolveProtoPath('worker_connection.proto');
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
const GRPC_READY_DEADLINE_MS = 10_000;

@injectable()
export class WorkerBaileysGrpcClientService {
  private buildConnectionProtoPayload(payload: StatusConnectionWorkerRequest): {
    worker_id: string;
    status: string;
    type: string;
    phone_connection?: string;
    remove_session?: boolean;
    connection_attempt_id?: string;
    runtime_generation?: number;
    warm_pool_id?: string;
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
    if (payload.connection_attempt_id) {
      (
        protoPayload as { connection_attempt_id?: string }
      ).connection_attempt_id = payload.connection_attempt_id;
    }
    if (payload.runtime_generation) {
      (protoPayload as { runtime_generation?: number }).runtime_generation =
        payload.runtime_generation;
    }
    if (payload.warm_pool_id) {
      (protoPayload as { warm_pool_id?: string }).warm_pool_id =
        payload.warm_pool_id;
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
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    return (
      grpcError.code === status.UNAVAILABLE ||
      grpcError.code === status.DEADLINE_EXCEEDED ||
      details.includes('econnrefused') ||
      details.includes('no connection established') ||
      details.includes('name resolution') ||
      details.includes('enotfound') ||
      message.includes('failed to connect before the deadline')
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
      connection_attempt_id?: string;
      runtime_generation?: number;
      warm_pool_id?: string;
    }
  ): Promise<IBaileysConnectionState> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).RequestConnection(
        protoPayload,
        metadata,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerConnectionStateProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }
          const state = protoToConnectionState(response ?? {});
          resolve(state);
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

  private async waitForReadyByAddress(
    address: string,
    timeoutMs: number
  ): Promise<string> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + timeoutMs);

    return new Promise<string>((resolve, reject) => {
      client.waitForReady(deadline, (err?: Error) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }

        resolve(address);
      });
    });
  }

  private async activateRuntimeByAddress(
    address: string,
    payload: IWorkerRuntimeActivationRequestProto
  ): Promise<IWorkerRuntimeActivationResponseProto> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    return new Promise<IWorkerRuntimeActivationResponseProto>(
      (resolve, reject) => {
        (client as any).ActivateRuntime(
          payload,
          metadata,
          { deadline },
          (
            err: ServiceError | null,
            response?: IWorkerRuntimeActivationResponseProto
          ): void => {
            client.close();
            if (err) {
              reject(err);
              return;
            }

            resolve(
              response ?? {
                worker_id: payload.worker_id,
                account_id: payload.account_id,
                activated: false,
                error: 'Empty gRPC response',
              }
            );
          }
        );
      }
    );
  }

  private async runtimeHealthByAddress(
    address: string,
    payload: IWorkerRuntimeHealthRequestProto
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    const client = new WorkerConnectionClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + GRPC_READY_DEADLINE_MS);

    return new Promise<IWorkerRuntimeHealthResponseProto>((resolve, reject) => {
      (client as any).RuntimeHealth(
        payload,
        { deadline },
        (
          err: ServiceError | null,
          response?: IWorkerRuntimeHealthResponseProto
        ): void => {
          client.close();
          if (err) {
            reject(err);
            return;
          }

          resolve(
            response ?? {
              worker_id: payload.worker_id,
              warm_pool_id: payload.warm_pool_id,
              ready: false,
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
  ): Promise<IBaileysConnectionState> {
    const protoPayload = this.buildConnectionProtoPayload(payload);

    return this.callWithFallback(workerId, workerType, (address) =>
      this.requestConnectionByAddress(address, protoPayload)
    );
  }

  async waitForReady(
    workerId: string,
    workerType?: EWorkerType,
    timeoutMs: number = GRPC_READY_DEADLINE_MS
  ): Promise<string> {
    return this.callWithFallback(workerId, workerType, (address) =>
      this.waitForReadyByAddress(address, timeoutMs)
    );
  }

  async activateRuntime(
    containerName: string,
    payload: IWorkerRuntimeActivationRequestProto,
    workerType?: EWorkerType
  ): Promise<IWorkerRuntimeActivationResponseProto> {
    return this.callWithFallback(containerName, workerType, (address) =>
      this.activateRuntimeByAddress(address, payload)
    );
  }

  async runtimeHealth(
    containerName: string,
    payload: IWorkerRuntimeHealthRequestProto,
    workerType?: EWorkerType
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    return this.callWithFallback(containerName, workerType, (address) =>
      this.runtimeHealthByAddress(address, payload)
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
