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
import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';

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
  private readonly isLocalEnvironment =
    process.env.APP_ENVIRONMENT === EAppEnvironment.local;

  private createClient(): any {
    const address = `${balanceEnvironment.grpcHost}:${balanceEnvironment.grpcPort}`;
    return new WorkerCommandClient(address, credentials.createInsecure());
  }

  async notifyWorkerStatus(payload: IBaileysConnectionState): Promise<void> {
    if (this.isLocalEnvironment) {
      return;
    }

    const client = this.createClient();

    const protoPayload = {
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_status_id: payload.worker_status_id ?? '',
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

  async resolveIncomingCallAction(
    payload: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    if (this.isLocalEnvironment) {
      return {};
    }

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
}
