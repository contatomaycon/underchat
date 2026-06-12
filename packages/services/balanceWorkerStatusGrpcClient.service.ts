import { inject, injectable } from 'tsyringe';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';
import { balanceEnvironment } from '@core/config/environments';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { connectionStateToProto } from '@core/common/functions/workerConnectionStateProtoMapper';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { normalizeTypingSimulationConfig } from '@core/common/functions/typingSimulationConfig';
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

const GRPC_DEADLINE_MS = 10000;

@injectable()
export class BalanceWorkerStatusGrpcClientService {
  constructor(
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  private createClient(): any {
    const address = `${balanceEnvironment.grpcHost}:${balanceEnvironment.grpcPort}`;
    return new WorkerCommandClient(address, credentials.createInsecure());
  }

  async notifyWorkerStatus(payload: IBaileysConnectionState): Promise<void> {
    const client = this.createClient();
    const workerId = payload.worker_id?.trim();
    const accountId = payload.account_id?.trim();
    const workerStatusId = payload.worker_status_id;

    if (!workerId || !accountId || !workerStatusId) {
      client.close();
      throw new Error(
        'NotifyWorkerStatus requires worker_id, account_id and worker_status_id'
      );
    }

    const protoPayload = connectionStateToProto({
      ...payload,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: workerStatusId,
    });

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);
    const metadata = new Metadata();

    void this.connectionLifecycleDebugService.log(
      'worker.notify_status_grpc.call',
      {
        trace_id: payload.debug_trace_id,
        layer: payload.worker_type_id ?? 'worker',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
        qrcode: payload.qrcode,
        pairing_code: payload.pairing_code,
      }
    );
    await new Promise<void>((resolve, reject) => {
      (client as any).NotifyWorkerStatus(
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
      'worker.notify_status_grpc.ok',
      {
        trace_id: payload.debug_trace_id,
        layer: payload.worker_type_id ?? 'worker',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
      }
    );
  }

  async registerS3BackupFallbackUpload(
    payload: IRegisterS3BackupFallbackUploadRequestProto
  ): Promise<void> {
    const client = this.createClient();

    const accountId = payload.account_id?.trim();
    const bucket = payload.bucket?.trim();
    const objectKey = payload.object_key?.trim();

    if (!accountId || !bucket || !objectKey) {
      client.close();
      throw new Error(
        'RegisterS3BackupFallbackUpload requires account_id, bucket and object_key'
      );
    }

    const sizeBytesRaw = payload.size_bytes;
    const sizeBytesNumber =
      typeof sizeBytesRaw === 'number'
        ? sizeBytesRaw
        : Number.parseInt(sizeBytesRaw ?? '0', 10);

    if (!Number.isFinite(sizeBytesNumber) || sizeBytesNumber < 0) {
      client.close();
      throw new Error(
        'RegisterS3BackupFallbackUpload requires valid size_bytes'
      );
    }

    const protoPayload = {
      account_id: accountId,
      bucket,
      object_key: objectKey,
      file_name: payload.file_name?.trim() ?? '',
      content_type: payload.content_type?.trim() ?? '',
      size_bytes: Math.trunc(sizeBytesNumber),
      primary_attempts: payload.primary_attempts ?? 0,
      backup_attempts: payload.backup_attempts ?? 0,
      primary_error: payload.primary_error ?? '',
      backup_error: payload.backup_error ?? '',
    };

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    await new Promise<void>((resolve, reject) => {
      (client as any).RegisterS3BackupFallbackUpload(
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

  async resolveIncomingCallAction(
    payload: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    const client = this.createClient();

    const protoPayload = {
      worker_id: payload.worker_id ?? '',
      account_id: payload.account_id ?? '',
      call_jid: payload.call_jid ?? '',
      call_phone: payload.call_phone ?? '',
      is_video: payload.is_video ?? false,
    };

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    return new Promise<IResolveIncomingCallActionResponseProto>(
      (resolve, reject) => {
        (client as any).ResolveIncomingCallAction(
          protoPayload,
          { deadline },
          (
            err: ServiceError | null,
            response?: IResolveIncomingCallActionResponseProto
          ) => {
            client.close();
            if (err) {
              reject(err);
              return;
            }
            resolve(response ?? {});
          }
        );
      }
    );
  }

  async getTypingSimulationConfig(
    payload: IGetTypingSimulationConfigRequestProto
  ): Promise<IGetTypingSimulationConfigResponseProto> {
    const client = this.createClient();

    const protoPayload = {
      worker_id: payload.worker_id ?? '',
      account_id: payload.account_id ?? '',
    };

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    return new Promise<IGetTypingSimulationConfigResponseProto>(
      (resolve, reject) => {
        (client as any).GetTypingSimulationConfig(
          protoPayload,
          { deadline },
          (
            err: ServiceError | null,
            response?: IGetTypingSimulationConfigResponseProto
          ) => {
            client.close();
            if (err) {
              reject(err);
              return;
            }
            resolve(normalizeTypingSimulationConfig(response));
          }
        );
      }
    );
  }
}
