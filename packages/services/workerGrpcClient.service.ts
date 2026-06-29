import { injectable, inject } from 'tsyringe';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { WorkerGrpcRegistryService } from '@core/services/workerGrpcRegistry.service';
import {
  workerPayloadToProto,
  statusConnectionRequestToProto,
} from '@core/common/functions/workerCommandProtoMapper';
import {
  WORKER_RECREATE_SERVER_SLOT_KEY_METADATA,
  WORKER_RECREATE_SERVER_SLOT_TOKEN_METADATA,
} from '@core/common/functions/workerRecreateServerSlotMetadata';
import { IWorkerPayloadProto } from '@core/common/interfaces/IWorkerPayloadProto';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';

const protoPath = resolveProtoPath('worker_command.proto');
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
    private readonly workerGrpcRegistryService: WorkerGrpcRegistryService,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  async createWorker(
    payload: IWorkerPayload,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<void> {
    await this.call('CreateWorker', payload, timeoutMs);
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

  async createWarmWorker(
    serverId: string,
    payload: ICreateWarmWorkerRequestProto,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<IWarmWorkerCommandResponseProto> {
    return this.callWarm('CreateWarmWorker', serverId, payload, timeoutMs);
  }

  async deleteWarmWorker(
    serverId: string,
    payload: IDeleteWarmWorkerRequestProto,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<void> {
    await this.callWarm('DeleteWarmWorker', serverId, payload, timeoutMs);
  }

  async activateWarmWorker(
    serverId: string,
    payload: IActivateWarmWorkerRequestProto,
    timeoutMs: number = GRPC_DEADLINE_MS
  ): Promise<IWarmWorkerCommandResponseProto> {
    return this.callWarm('ActivateWarmWorker', serverId, payload, timeoutMs);
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
    const metadata = new Metadata();
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.change_connection_status_call',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        method: 'ChangeConnectionStatus',
        grpc_address: address,
      }
    );
    await new Promise<void>((resolve, reject) => {
      (client as any).ChangeConnectionStatus(
        protoPayload,
        metadata,
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
    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.change_connection_status_ok',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        method: 'ChangeConnectionStatus',
        grpc_address: address,
      }
    );
  }

  private async call(
    method:
      'CreateWorker' | 'DeleteWorker' | 'RecreateWorker' | 'CleanupWorker',
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
    const metadata = new Metadata();
    this.applyRecreateServerSlotMetadata(metadata, payload);
    const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;
    const options = deadline ? { deadline } : {};

    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.call',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.lifecycle_operation_id,
        method,
        grpc_address: address,
      }
    );
    await new Promise<void>((resolve, reject) => {
      const callback = (err: ServiceError | null) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      (client as any)[method](protoPayload, metadata, options, callback);
    });
    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.ok',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        lifecycle_operation_id: payload.lifecycle_operation_id,
        method,
        grpc_address: address,
      }
    );
  }

  private applyRecreateServerSlotMetadata(
    metadata: Metadata,
    payload: IWorkerPayload
  ): void {
    if (
      !payload.recreate_server_slot_key ||
      !payload.recreate_server_slot_token
    ) {
      return;
    }

    metadata.set(
      WORKER_RECREATE_SERVER_SLOT_KEY_METADATA,
      payload.recreate_server_slot_key
    );
    metadata.set(
      WORKER_RECREATE_SERVER_SLOT_TOKEN_METADATA,
      payload.recreate_server_slot_token
    );
  }

  private async callWarm(
    method: 'CreateWarmWorker' | 'DeleteWarmWorker' | 'ActivateWarmWorker',
    serverId: string,
    payload:
      | ICreateWarmWorkerRequestProto
      | IDeleteWarmWorkerRequestProto
      | IActivateWarmWorkerRequestProto,
    timeoutMs?: number
  ): Promise<IWarmWorkerCommandResponseProto> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );
    const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;
    const metadata = new Metadata();
    const options = deadline ? { deadline } : {};
    const debugTraceId = (payload as { debug_trace_id?: string })
      .debug_trace_id;
    const workerId = (payload as { worker_id?: string }).worker_id;
    const accountId = (payload as { account_id?: string }).account_id;
    const workerTypeId = (payload as { worker_type_id?: string })
      .worker_type_id;
    const lifecycleOperationId = (
      payload as { lifecycle_operation_id?: string }
    ).lifecycle_operation_id;

    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.warm_call',
      {
        trace_id: debugTraceId,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        lifecycle_operation_id: lifecycleOperationId,
        method,
        grpc_address: address,
      }
    );

    return new Promise<IWarmWorkerCommandResponseProto>((resolve, reject) => {
      const callback = (
        err: ServiceError | null,
        response?: IWarmWorkerCommandResponseProto
      ) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }
        resolve(response ?? {});
      };

      (client as any)[method](payload, metadata, options, callback);
    }).then((response) => {
      void this.connectionLifecycleDebugService.log(
        'service.worker_command_grpc.warm_ok',
        {
          trace_id: debugTraceId,
          layer: 'service',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerTypeId,
          lifecycle_operation_id: lifecycleOperationId,
          method,
          grpc_address: address,
        }
      );
      return response;
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
