import { injectable } from 'tsyringe';
import path from 'path';
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
  WorkerPayloadProto,
} from '@core/common/functions/workerCommandProtoMapper';

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
export class WorkerGrpcClientService {
  constructor(
    private readonly workerGrpcRegistryService: WorkerGrpcRegistryService
  ) {}

  async createWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('CreateWorker', payload);
  }

  async deleteWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('DeleteWorker', payload);
  }

  async recreateWorker(payload: IWorkerPayload): Promise<void> {
    await this.call('RecreateWorker', payload);
  }

  private async call(
    method: 'CreateWorker' | 'DeleteWorker' | 'RecreateWorker',
    payload: IWorkerPayload
  ): Promise<void> {
    const { host, port } = await this.workerGrpcRegistryService.getAddress(
      payload.server_id
    );
    const address = `${host}:${port}`;
    const client = new WorkerCommandClient(
      address,
      credentials.createInsecure()
    );

    const protoPayload: WorkerPayloadProto = workerPayloadToProto(payload);

    await new Promise<void>((resolve, reject) => {
      (client as any)[method](protoPayload, (err: ServiceError | null) => {
        client.close();
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}
