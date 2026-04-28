import { injectable } from 'tsyringe';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  ServiceError,
} from '@grpc/grpc-js';
import { balanceEnvironment } from '@core/config/environments';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { normalizeTypingSimulationConfig } from '@core/common/functions/typingSimulationConfig';

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

const GRPC_DEADLINE_MS = 10000;

@injectable()
export class BalanceWorkerStatusGrpcClientService {
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

    const protoPayload = {
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: workerStatusId,
      phone: payload.phone ?? '',
      disconnected_user: payload.disconnected_user ?? false,
    };

    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    await new Promise<void>((resolve, reject) => {
      (client as any).NotifyWorkerStatus(
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
