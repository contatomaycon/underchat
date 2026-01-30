import { injectable } from 'tsyringe';
import path from 'path';
import { loadSync } from '@grpc/proto-loader';
import {
  loadPackageDefinition,
  credentials,
  ServiceError,
} from '@grpc/grpc-js';
import { balanceEnvironment } from '@core/config/environments';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

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

@injectable()
export class BalanceWorkerStatusGrpcClientService {
  async notifyWorkerStatus(payload: IBaileysConnectionState): Promise<void> {
    const address = `${balanceEnvironment.grpcHost}:${balanceEnvironment.grpcPort}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );

    const protoPayload = {
      worker_id: payload.worker_id,
      account_id: payload.account_id,
      worker_status_id: payload.worker_status_id ?? '',
      phone: payload.phone ?? '',
      disconnected_user: payload.disconnected_user ?? false,
    };

    await new Promise<void>((resolve, reject) => {
      (client as any).NotifyWorkerStatus(
        protoPayload,
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
}
