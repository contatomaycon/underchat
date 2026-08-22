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
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ISecureConnectionImportRequest } from '@core/common/interfaces/ISecureConnectionSession';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { protoToConnectionState } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  IWorkerRuntimeHealthRequestProto,
  IWorkerRuntimeHealthResponseProto,
} from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import {
  IPrepareSessionStorageMigrationRequestProto,
  IPrepareSessionStorageMigrationResponseProto,
} from '@core/common/interfaces/ISessionStorageMigrationPrepareProto';
import {
  commandProtoToSessionStorageMigrationResponse,
  type ICommandSessionStorageMigrationPrepareResponse,
  sessionStorageMigrationPrepareToCommandProto,
} from '@core/common/functions/sessionStorageMigrationCommandProtoMapper';
import {
  ILegacySessionVolumeDeleteRequestProto,
  ILegacySessionVolumeDeleteResponseProto,
} from '@core/common/interfaces/ILegacySessionVolumeDeleteProto';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import {
  BALANCE_WARM_CONTROL_TOKEN_METADATA,
  balanceRuntimeFenceToken,
  balanceWarmControlToken,
} from '@core/common/functions/balanceRuntimeFenceCredential';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { ConnectionLifecycleDebugService } from '@core/services/connectionLifecycleDebug.service';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';
import type { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import { BALANCER_RUNTIME_FENCE_TOKEN_METADATA } from '@core/common/functions/balancerRuntimeFenceAuth';

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

function positiveTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const GRPC_DEADLINE_MS = 10_000;
const SECURE_IMPORT_GRPC_DEADLINE_MS = 120_000;
const RUNTIME_HEALTH_GRPC_DEADLINE_MS = 10_000;
const SESSION_STORAGE_MIGRATION_GRPC_DEADLINE_MS = 310_000;
const DOWNSTREAM_REQUEST_CONNECTION_GRPC_DEADLINE_MS = Math.min(
  120_000,
  Math.max(
    10_000,
    positiveTimeout(
      process.env.WORKER_REQUEST_CONNECTION_GRPC_DEADLINE_MS,
      45_000
    )
  )
);
const WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS = Math.min(
  180_000,
  Math.max(
    DOWNSTREAM_REQUEST_CONNECTION_GRPC_DEADLINE_MS + 30_000,
    positiveTimeout(
      process.env.WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS,
      DOWNSTREAM_REQUEST_CONNECTION_GRPC_DEADLINE_MS + 30_000
    )
  )
);
const WORKER_DELETE_GRPC_DEADLINE_MS = positiveTimeout(
  process.env.WORKER_DELETE_GRPC_DEADLINE_MS,
  5 * 60_000
);
const WORKER_LIFECYCLE_GRPC_DEADLINE_MS = workerLifecycleBudgets.grpcDeadlineMs;

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
    timeoutMs: number = WORKER_LIFECYCLE_GRPC_DEADLINE_MS
  ): Promise<void> {
    await this.call('CreateWorker', payload, timeoutMs);
  }

  async deleteWorker(
    payload: IWorkerPayload,
    timeoutMs: number = WORKER_DELETE_GRPC_DEADLINE_MS
  ): Promise<void> {
    await this.call('DeleteWorker', payload, timeoutMs);
  }

  async recreateWorker(
    payload: IWorkerPayload,
    timeoutMs: number = WORKER_LIFECYCLE_GRPC_DEADLINE_MS
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
    accountId: string,
    timeoutMs: number = WORKER_CONNECTION_STATUS_GRPC_DEADLINE_MS
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
    const deadline = new Date(Date.now() + timeoutMs);

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

  async requestWorkerSelfHealing(
    serverId: string,
    payload: IWorkerSelfHealingRequestProto
  ): Promise<void> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const client = new WorkerCommandClient(
      `${host}:${port}`,
      credentials.createInsecure()
    );
    const metadata = new Metadata();
    metadata.set(
      BALANCER_RUNTIME_FENCE_TOKEN_METADATA,
      balanceRuntimeFenceToken()
    );
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    await new Promise<void>((resolve, reject) => {
      (client as any).RequestWorkerSelfHealing(
        payload,
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
    metadata.set(
      BALANCE_WARM_CONTROL_TOKEN_METADATA,
      balanceWarmControlToken()
    );
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

  async importSecureSession(
    serverId: string,
    payload: ISecureConnectionImportRequest,
    timeoutMs: number = SECURE_IMPORT_GRPC_DEADLINE_MS
  ): Promise<IBaileysConnectionState> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + timeoutMs);
    const metadata = new Metadata();
    const protoPayload = {
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_type_id: payload.worker_type_id ?? '',
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation ?? 0,
      format_version: payload.format_version,
      source: payload.source,
      target_provider: payload.target_provider,
      payload_ref: payload.payload_ref ?? '',
      payload_json: payload.payload_json ?? '',
      checksum: payload.checksum ?? '',
      debug_trace_id: payload.debug_trace_id ?? '',
      authorized_connection_epoch: payload.authorized_connection_epoch ?? '',
    };

    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.secure_import_call',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        authorized_connection_epoch_set: Boolean(
          payload.authorized_connection_epoch
        ),
        method: 'ImportSecureSession',
        grpc_address: address,
      }
    );

    return new Promise<IBaileysConnectionState>((resolve, reject) => {
      (client as any).ImportSecureSession(
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
          resolve(protoToConnectionState(response ?? {}));
        }
      );
    }).then((state) => {
      void this.connectionLifecycleDebugService.log(
        'service.worker_command_grpc.secure_import_ok',
        {
          trace_id: state.debug_trace_id ?? payload.debug_trace_id,
          layer: 'service',
          worker_id: state.worker_id || payload.worker_id,
          account_id: state.account_id || payload.account_id,
          worker_type_id: state.worker_type_id ?? payload.worker_type_id,
          connection_attempt_id:
            state.connection_attempt_id ?? payload.connection_attempt_id,
          runtime_generation:
            state.runtime_generation ?? payload.runtime_generation,
          status: state.status,
          code: state.code,
          reason: state.reason,
          session_ready: state.session_ready,
          authenticated: state.authenticated,
          method: 'ImportSecureSession',
          grpc_address: address,
        }
      );
      return state;
    });
  }

  async prepareSessionStorageMigration(
    serverId: string,
    payload: IPrepareSessionStorageMigrationRequestProto
  ): Promise<IPrepareSessionStorageMigrationResponseProto> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const client = new WorkerCommandClient(
      `${host}:${port}`,
      credentials.createInsecure()
    );
    const metadata = new Metadata();
    const deadline = new Date(
      Date.now() + SESSION_STORAGE_MIGRATION_GRPC_DEADLINE_MS
    );
    return new Promise((resolve, reject) => {
      (client as any).PrepareSessionStorageMigration(
        sessionStorageMigrationPrepareToCommandProto(payload),
        metadata,
        { deadline },
        (
          error: ServiceError | null,
          response?: ICommandSessionStorageMigrationPrepareResponse
        ) => {
          client.close();
          if (error) {
            reject(error);
            return;
          }
          if (!response) {
            reject(
              new Error('prepare_session_storage_migration_empty_response')
            );
            return;
          }
          resolve(commandProtoToSessionStorageMigrationResponse(response));
        }
      );
    });
  }

  async deleteLegacySessionVolume(
    serverId: string,
    payload: ILegacySessionVolumeDeleteRequestProto
  ): Promise<ILegacySessionVolumeDeleteResponseProto> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const client = new WorkerCommandClient(
      `${host}:${port}`,
      credentials.createInsecure()
    );
    return new Promise((resolve, reject) => {
      (client as any).DeleteLegacySessionVolume(
        payload,
        new Metadata(),
        { deadline: new Date(Date.now() + 30_000) },
        (
          error: ServiceError | null,
          response?: ILegacySessionVolumeDeleteResponseProto
        ) => {
          client.close();
          if (error) {
            reject(error);
            return;
          }
          if (!response) {
            reject(new Error('legacy_session_volume_delete_empty_response'));
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async runtimeHealth(
    serverId: string,
    payload: IWorkerRuntimeHealthRequestProto,
    timeoutMs: number = RUNTIME_HEALTH_GRPC_DEADLINE_MS
  ): Promise<IWorkerRuntimeHealthResponseProto> {
    const { host, port } =
      await this.workerGrpcRegistryService.getAddress(serverId);
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );
    const deadline = new Date(Date.now() + timeoutMs);
    const metadata = new Metadata();

    void this.connectionLifecycleDebugService.log(
      'service.worker_command_grpc.runtime_health_call',
      {
        layer: 'service',
        worker_id: payload.worker_id,
        warm_pool_id: payload.warm_pool_id,
        method: 'RuntimeHealth',
        grpc_address: address,
      }
    );

    return new Promise<IWorkerRuntimeHealthResponseProto>((resolve, reject) => {
      (client as any).RuntimeHealth(
        payload,
        metadata,
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
    }).then((health) => {
      void this.connectionLifecycleDebugService.log(
        'service.worker_command_grpc.runtime_health_ok',
        {
          layer: 'service',
          worker_id: health.worker_id || payload.worker_id,
          warm_pool_id: health.warm_pool_id || payload.warm_pool_id,
          worker_type_id: health.worker_type_id,
          runtime_generation: health.runtime_generation,
          session_ready: health.session_ready,
          authenticated: health.authenticated,
          can_send: health.can_send,
          can_receive_runtime: health.can_receive_runtime,
          activated: health.activated,
          standby: health.standby,
          provider_state: health.provider_state,
          degraded_reason: health.degraded_reason,
          kafka_unhealthy: health.kafka_unhealthy,
          phone_present: Boolean(health.phone),
          error_present: Boolean(health.error),
          method: 'RuntimeHealth',
          grpc_address: address,
        }
      );
      return health;
    });
  }
}
