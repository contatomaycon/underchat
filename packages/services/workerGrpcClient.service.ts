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
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerConnectionStateProto } from '@core/common/interfaces/IWorkerConnectionStateProto';
import { protoToConnectionState } from '@core/common/functions/workerConnectionStateProtoMapper';
import {
  buildConnectionLifecycleContext,
  injectGrpcConnectionMetadata,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';

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
const CONNECTION_QR_GRPC_DEADLINE_MS = 90_000;

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

  async changeConnectionStatus(
    serverId: string,
    payload: StatusConnectionWorkerRequest,
    accountId: string
  ): Promise<void> {
    const contextData = buildConnectionLifecycleContext({
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

  async requestConnectionQrCode(
    serverId: string,
    payload: StatusConnectionWorkerRequest,
    accountId: string
  ): Promise<IBaileysConnectionState> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: payload.worker_id,
      channel_id: payload.worker_id,
      source_provider: 'manager',
      connection_type: payload.type,
      connection_action: 'request_qrcode',
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
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
      const deadline = new Date(Date.now() + CONNECTION_QR_GRPC_DEADLINE_MS);

      recordConnectionLifecycle({
        stage: 'connection.manager.worker_command_grpc.qrcode_start',
        decision: 'grpc_request_connection_qrcode',
        outcome: 'started',
        grpc_method: 'RequestConnectionQrCode',
        grpc_address: address,
        deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
        server_id: serverId,
        status: payload.status,
        connection_type: payload.type,
      });

      return new Promise<IBaileysConnectionState>((resolve, reject) => {
        (client as any).RequestConnectionQrCode(
          protoPayload,
          metadata,
          { deadline },
          (
            err: ServiceError | null,
            response?: IWorkerConnectionStateProto
          ): void => {
            client.close();
            if (err) {
              recordConnectionLifecycle({
                stage: 'connection.manager.worker_command_grpc.qrcode_error',
                decision: 'grpc_request_connection_qrcode',
                outcome: 'error',
                reason: 'grpc_error',
                level: 'error',
                grpc_method: 'RequestConnectionQrCode',
                grpc_address: address,
                deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
                error: err.message,
              });
              reject(err);
              return;
            }

            const state = protoToConnectionState(response ?? {});
            recordConnectionLifecycle({
              stage: 'connection.manager.worker_command_grpc.qrcode_success',
              decision: 'grpc_request_connection_qrcode',
              outcome: 'success',
              grpc_method: 'RequestConnectionQrCode',
              grpc_address: address,
              deadline_ms: CONNECTION_QR_GRPC_DEADLINE_MS,
              status: state.status,
              code: state.code,
              qrcode: state.qrcode,
              pairing_code: state.pairing_code,
              has_qr: Boolean(state.qrcode),
              has_pairing_code: Boolean(state.pairing_code),
            });
            resolve(state);
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
