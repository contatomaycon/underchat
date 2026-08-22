import { inject, injectable } from 'tsyringe';
import type {
  Client,
  Metadata,
  ServiceClientConstructor,
  ServiceError,
} from '@grpc/grpc-js';
import { balanceEnvironment } from '@core/config/environments';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import { resolveProtoPath } from '@core/common/functions/resolveProtoPath';
import { IWhatsappRuntimeFenceActivationRequestProto } from '@core/common/interfaces/IWhatsappRuntimeFenceActivationProto';
import {
  IChromiumLockCleanupAuthorizationRequestProto,
  IChromiumLockCleanupAuthorizationResponseProto,
} from '@core/common/interfaces/IChromiumLockCleanupAuthorizationProto';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  BALANCER_RUNTIME_FENCE_TOKEN_METADATA,
  balancerRuntimeFenceToken,
} from '@core/common/functions/balancerRuntimeFenceAuth';
import {
  WorkerRuntimeDatabaseService,
  type WorkerRuntimeOwnedConnectionFence,
  type WorkerRuntimeEventPersistenceOptions,
} from '@core/services/workerRuntimeDatabase.service';

interface LegacyWorkerCommandClient extends Client {
  AuthorizeChromiumLockCleanup(
    request: IChromiumLockCleanupAuthorizationRequestProto,
    metadata: Metadata,
    options: { deadline: Date },
    callback: (
      error: ServiceError | null,
      response?: IChromiumLockCleanupAuthorizationResponseProto
    ) => void
  ): void;
}

interface LegacyWorkerCommandRuntime {
  grpc: typeof import('@grpc/grpc-js');
  WorkerCommandClient: ServiceClientConstructor;
}

let legacyWorkerCommandRuntimePromise:
  Promise<LegacyWorkerCommandRuntime> | undefined;

async function loadLegacyWorkerCommandRuntime(): Promise<LegacyWorkerCommandRuntime> {
  if (!legacyWorkerCommandRuntimePromise) {
    legacyWorkerCommandRuntimePromise = Promise.all([
      import('@grpc/grpc-js'),
      import('@grpc/proto-loader'),
    ])
      .then(([grpc, protoLoader]) => {
        const protoPath = resolveProtoPath('worker_command.proto');
        const packageDefinition = protoLoader.loadSync(protoPath, {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        });
        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        const workerCommandClient = (
          protoDescriptor as unknown as {
            worker_command?: { WorkerCommand?: unknown };
          }
        ).worker_command?.WorkerCommand;

        if (typeof workerCommandClient !== 'function') {
          throw new Error('WorkerCommand client not found in proto');
        }

        return {
          grpc,
          WorkerCommandClient: workerCommandClient as ServiceClientConstructor,
        };
      })
      .catch((error: unknown) => {
        legacyWorkerCommandRuntimePromise = undefined;
        throw error;
      });
  }

  return legacyWorkerCommandRuntimePromise;
}

const GRPC_DEADLINE_MS = 10000;

@injectable()
export class BalanceWorkerStatusGrpcClientService {
  constructor(
    @inject(WorkerRuntimeDatabaseService)
    private readonly workerRuntimeDatabaseService: WorkerRuntimeDatabaseService = new WorkerRuntimeDatabaseService()
  ) {}

  private async createClient(): Promise<{
    client: LegacyWorkerCommandClient;
    grpc: typeof import('@grpc/grpc-js');
  }> {
    const { grpc, WorkerCommandClient } =
      await loadLegacyWorkerCommandRuntime();
    const address = `${balanceEnvironment.grpcHost}:${balanceEnvironment.grpcPort}`;
    const client = new WorkerCommandClient(
      address,
      grpc.credentials.createInsecure()
    ) as unknown as LegacyWorkerCommandClient;
    return { client, grpc };
  }

  async authorizeChromiumLockCleanup(
    payload: IChromiumLockCleanupAuthorizationRequestProto
  ): Promise<IChromiumLockCleanupAuthorizationResponseProto> {
    const request = {
      request_id: payload.request_id?.trim(),
      worker_id: payload.worker_id?.trim(),
      account_id: payload.account_id?.trim(),
      worker_type_id: payload.worker_type_id?.trim().toLowerCase(),
      runtime_generation: Number(payload.runtime_generation),
      requester_container_id: payload.requester_container_id
        ?.trim()
        .toLowerCase(),
      session_volume_name: payload.session_volume_name?.trim(),
      singleton_lock_target: payload.singleton_lock_target?.trim(),
    };
    if (
      !request.request_id ||
      !request.worker_id ||
      !request.account_id ||
      request.worker_type_id !== EWorkerType.wwebjs ||
      !Number.isSafeInteger(request.runtime_generation) ||
      request.runtime_generation <= 0 ||
      !request.requester_container_id ||
      !request.session_volume_name ||
      !request.singleton_lock_target
    ) {
      throw new Error('Invalid Chromium lock cleanup authorization payload');
    }

    const runtimeFenceToken = balancerRuntimeFenceToken();
    const { client, grpc } = await this.createClient();
    const metadata = new grpc.Metadata();
    metadata.set(BALANCER_RUNTIME_FENCE_TOKEN_METADATA, runtimeFenceToken);
    const deadline = new Date(Date.now() + GRPC_DEADLINE_MS);

    return new Promise((resolve, reject) => {
      try {
        client.AuthorizeChromiumLockCleanup(
          request,
          metadata,
          { deadline },
          (
            err: ServiceError | null,
            response?: IChromiumLockCleanupAuthorizationResponseProto
          ) => {
            client.close();
            if (err) {
              reject(err);
              return;
            }
            resolve(response ?? {});
          }
        );
      } catch (error) {
        client.close();
        reject(error);
      }
    });
  }

  async activateWhatsappRuntimeFence(
    payload: IWhatsappRuntimeFenceActivationRequestProto
  ): Promise<{
    connection_sequence: number;
    already_active: boolean;
  }> {
    return this.workerRuntimeDatabaseService.activateWhatsappRuntimeFence(
      payload
    );
  }

  async resolveWhatsappRuntimeOwnedConnectionFence(input: {
    worker_id?: string;
    account_id?: string;
    source_provider?: string;
    runtime_generation?: number;
  }): Promise<WorkerRuntimeOwnedConnectionFence | null> {
    return this.workerRuntimeDatabaseService.resolveWhatsappRuntimeOwnedConnectionFence(
      input
    );
  }

  async notifyWorkerStatus(
    payload: IBaileysConnectionState,
    options: WorkerRuntimeEventPersistenceOptions = {}
  ): Promise<void> {
    await this.workerRuntimeDatabaseService.notifyWorkerStatus(
      payload,
      options
    );
  }

  async publishWorkerRuntimeEvent(
    payload: IBaileysConnectionState,
    options: WorkerRuntimeEventPersistenceOptions = {}
  ): Promise<void> {
    await this.workerRuntimeDatabaseService.publishWorkerRuntimeEvent(
      payload,
      options
    );
  }

  async registerS3BackupFallbackUpload(
    payload: IRegisterS3BackupFallbackUploadRequestProto
  ): Promise<void> {
    await this.workerRuntimeDatabaseService.registerS3BackupFallbackUpload(
      payload
    );
  }

  async requestWorkerSelfHealing(
    payload: IWorkerSelfHealingRequestProto
  ): Promise<void> {
    await this.workerRuntimeDatabaseService.requestWorkerSelfHealing(payload);
  }

  async resolveIncomingCallAction(
    payload: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    return this.workerRuntimeDatabaseService.resolveIncomingCallAction(payload);
  }

  async getTypingSimulationConfig(
    payload: IGetTypingSimulationConfigRequestProto
  ): Promise<IGetTypingSimulationConfigResponseProto> {
    return this.workerRuntimeDatabaseService.getTypingSimulationConfig(
      payload.worker_id ?? '',
      payload.account_id ?? ''
    );
  }
}
