import { injectable, inject } from 'tsyringe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  ServiceError,
} from '@grpc/grpc-js';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { WorkerGrpcRegistryService } from '@core/services/workerGrpcRegistry.service';
import {
  workerPayloadToProto,
  statusConnectionRequestToProto,
} from '@core/common/functions/workerCommandProtoMapper';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const protoPath = path.join(__dirname, '..', 'proto', 'worker_command.proto');
const packageDefinition = loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = loadPackageDefinition(packageDefinition);
const WorkerCommandClient = (protoDescriptor as any).worker_command
  ?.WorkerCommand;

if (!WorkerCommandClient) {
  throw new Error('WorkerCommand client not found in proto');
}

const GRPC_DEADLINE_MS = 10_000;

@injectable()
export class WorkerGrpcClientService {
  constructor(
    @inject(WorkerGrpcRegistryService)
    private readonly workerGrpcRegistryService: WorkerGrpcRegistryService
  ) {}

  async createWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('CreateWorker', payload);
  }

  async deleteWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('DeleteWorker', payload);
  }

  async recreateWorker(
    payload: IWorkerPayload,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<void> {
    await this.call('RecreateWorker', payload, timeoutMs);
  }

  async cleanupWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('CleanupWorker', payload, GRPC_DEADLINE_MS);
  }

  async changeConnectionStatus(
    serverId: string,
    payload: StatusConnectionWorkerRequest,
    accountId: string
  ): Promise<void> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );

    const protoPayload = statusConnectionRequestToProto(payload, accountId);

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    await new Promise<void>((resolve, reject) => {
      (client as any).ChangeConnectionStatus(
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

  private async call(
    method:
      | 'CreateWorker'
      | 'DeleteWorker'
      | 'RecreateWorker'
      | 'CleanupWorker',
    payload: IWorkerPayload,
    timeoutMs?: number
  ): Promise<void> {
    const { host, port } = await this.workerGrpcRegistryService.getAddress(
      payload.server_id
    );
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );

    const protoPayload: IWorkerPayloadProto = workerPayloadToProto(payload);
    const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;

    await new Promise<void>((resolve, reject) => {
      const callback = (err: ServiceError | null) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      if (deadline) {
        (client as any)[method](protoPayload, { deadline }, callback);
        return;
      }

      (client as any)[method](protoPayload, callback);
    });
  }

  async validatePhone(
    serverId: string,
    payload: IPhoneValidationRequest,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<IPhoneValidationResponse> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + timeoutMs);

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
}
