import { injectable, inject } from 'tsyringe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {
  buildConnectionLifecycleContext,
  injectGrpcConnectionMetadata,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import { recordConnectionAttemptTelemetry } from '@core/plugins/telemetry/connectionAttemptTelemetry';

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
    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: payload.connection_lifecycle_id,
      account_id: accountId,
      worker_id: payload.worker_id,
      channel_id: payload.worker_id,
      source_provider: 'manager',
      connection_type: payload.type,
      connection_action: 'change_status',
    });

    await runWithConnectionLifecycleContext(contextData, async () => {
      const { host, port } =
        await this.workerGrpcRegistryService.getAddress(serverId);
      const address = `${host}:${port}`;
      const client = new WorkerCommandClient(
        address,
        credentials.createInsecure()
      );

      const protoPayload = statusConnectionRequestToProto(payload, accountId);
      const metadata = injectGrpcConnectionMetadata(
        new Metadata(),
        contextData
      );
      const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

      recordConnectionLifecycle({
        stage: 'connection.manager.worker_command_grpc.change_status_start',
        decision: 'grpc_change_connection_status',
        outcome: 'started',
        grpc_method: 'ChangeConnectionStatus',
        grpc_address: address,
        deadline_ms: GRPC_DEADLINE_MS,
        server_id: serverId,
        status: payload.status,
        connection_type: payload.type,
      });

      await new Promise<void>((resolve, reject) => {
        (client as any).ChangeConnectionStatus(
          protoPayload,
          metadata,
          { deadline },
          (err: ServiceError | null) => {
            client.close();
            if (err) {
              recordConnectionLifecycle({
                stage:
                  'connection.manager.worker_command_grpc.change_status_error',
                decision: 'grpc_change_connection_status',
                outcome: 'error',
                reason: 'grpc_error',
                level: 'error',
                grpc_method: 'ChangeConnectionStatus',
                grpc_address: address,
                deadline_ms: GRPC_DEADLINE_MS,
                error: err.message,
              });
              reject(err);
              return;
            }
            recordConnectionLifecycle({
              stage:
                'connection.manager.worker_command_grpc.change_status_success',
              decision: 'grpc_change_connection_status',
              outcome: 'success',
              grpc_method: 'ChangeConnectionStatus',
              grpc_address: address,
              deadline_ms: GRPC_DEADLINE_MS,
            });
            resolve();
          }
        );
      });
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
    const contextData = buildConnectionLifecycleContext({
      account_id: payload.account_id,
      worker_id: payload.worker_id,
      channel_id: payload.worker_id,
      worker_type: payload.worker_type_id,
      source_provider: 'manager',
      connection_action: method,
    });

    await runWithConnectionLifecycleContext(contextData, async () => {
      const { host, port } = await this.workerGrpcRegistryService.getAddress(
        payload.server_id
      );
      const address = `${host}:${port}`;
      const client = new WorkerCommandClient(
        address,
        credentials.createInsecure()
      );

      const protoPayload: IWorkerPayloadProto = workerPayloadToProto(payload);
      const metadata = injectGrpcConnectionMetadata(
        new Metadata(),
        contextData
      );
      const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;
      const options = deadline ? { deadline } : {};

      recordConnectionLifecycle({
        stage: 'connection.manager.worker_command_grpc.command_start',
        decision: 'grpc_worker_command',
        outcome: 'started',
        grpc_method: method,
        grpc_address: address,
        deadline_ms: timeoutMs,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        status: payload.worker_status_id,
      });
      recordConnectionAttemptTelemetry({
        event: 'manager_balancer_worker_command_start',
        stage: 'connection.manager.worker_command_grpc.command_start',
        metric_event: 'grpc_request',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        server_id: payload.server_id,
        worker_type: payload.worker_type_id,
        grpc_method: method,
        grpc_address: address,
        outcome: 'started',
        deadline_ms: timeoutMs,
      });

      await new Promise<void>((resolve, reject) => {
        const callback = (err: ServiceError | null) => {
          client.close();
          if (err) {
            recordConnectionLifecycle({
              stage: 'connection.manager.worker_command_grpc.command_error',
              decision: 'grpc_worker_command',
              outcome: 'error',
              reason: 'grpc_error',
              level: 'error',
              grpc_method: method,
              grpc_address: address,
              deadline_ms: timeoutMs,
              server_id: payload.server_id,
              worker_type: payload.worker_type_id,
              error: err.message,
            });
            reject(err);
            return;
          }
          recordConnectionLifecycle({
            stage: 'connection.manager.worker_command_grpc.command_success',
            decision: 'grpc_worker_command',
            outcome: 'success',
            grpc_method: method,
            grpc_address: address,
            deadline_ms: timeoutMs,
            server_id: payload.server_id,
            worker_type: payload.worker_type_id,
          });
          resolve();
        };

        (client as any)[method](protoPayload, metadata, options, callback);
      });
    });
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
    const workerId = 'worker_id' in payload ? payload.worker_id : undefined;
    const accountId = 'account_id' in payload ? payload.account_id : undefined;
    const workerType =
      'worker_type_id' in payload ? payload.worker_type_id : undefined;
    const warmPoolId =
      'warm_pool_id' in payload ? payload.warm_pool_id : undefined;
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: workerId,
      channel_id: workerId,
      worker_type: workerType,
      source_provider: 'manager',
      connection_action: method,
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
      const { host, port } =
        await this.workerGrpcRegistryService.getAddress(serverId);
      const address = `${host}:${port}`;
      const client = new WorkerCommandClient(
        address,
        credentials.createInsecure()
      );
      const deadline = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;
      const metadata = injectGrpcConnectionMetadata(
        new Metadata(),
        contextData
      );
      const options = deadline ? { deadline } : {};

      recordConnectionLifecycle({
        stage: 'connection.manager.worker_command_grpc.warm_command_start',
        decision: 'grpc_warm_worker_command',
        outcome: 'started',
        grpc_method: method,
        grpc_address: address,
        deadline_ms: timeoutMs,
        server_id: serverId,
        worker_type: workerType,
        warm_pool_id: warmPoolId,
      });
      recordConnectionAttemptTelemetry({
        event: 'manager_balancer_warm_command_start',
        stage: 'connection.manager.worker_command_grpc.warm_command_start',
        metric_event: 'grpc_request',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerType,
        warm_pool_id: warmPoolId,
        grpc_method: method,
        grpc_address: address,
        outcome: 'started',
        deadline_ms: timeoutMs,
      });

      return new Promise<IWarmWorkerCommandResponseProto>((resolve, reject) => {
        const callback = (
          err: ServiceError | null,
          response?: IWarmWorkerCommandResponseProto
        ) => {
          client.close();
          if (err) {
            recordConnectionLifecycle({
              stage:
                'connection.manager.worker_command_grpc.warm_command_error',
              decision: 'grpc_warm_worker_command',
              outcome: 'error',
              reason: 'grpc_error',
              level: 'error',
              grpc_method: method,
              grpc_address: address,
              deadline_ms: timeoutMs,
              server_id: serverId,
              worker_type: workerType,
              warm_pool_id: warmPoolId,
              error: err.message,
            });
            reject(err);
            return;
          }
          recordConnectionLifecycle({
            stage:
              'connection.manager.worker_command_grpc.warm_command_success',
            decision: 'grpc_warm_worker_command',
            outcome: 'success',
            grpc_method: method,
            grpc_address: address,
            deadline_ms: timeoutMs,
            server_id: serverId,
            worker_type: workerType,
            warm_pool_id: warmPoolId,
          });
          resolve(response ?? {});
        };

        (client as any)[method](payload, metadata, options, callback);
      });
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
