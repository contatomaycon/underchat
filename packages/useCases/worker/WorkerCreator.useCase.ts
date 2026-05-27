import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { AccountService } from '@core/services/account.service';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { v7 as uuidv7 } from 'uuid';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { PlanAccountService } from '@core/services/planAccount.service';
import { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';

@injectable()
export class WorkerCreatorUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(WorkerGrpcClientService)
    private readonly workerGrpcClientService: WorkerGrpcClientService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService
  ) {}

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }

    await this.planAccountService.validateCanCreateWorker(t, accountId);
  }

  private async onWorkerCreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    try {
      await this.workerGrpcClientService.createWorker(payload);
    } catch (err) {
      throw new Error(t('grpc_error'), { cause: err });
    }
  }

  private dispatchWorkerCreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): void {
    void this.onWorkerCreated(t, payload).catch((err) => {
      void this.publishWorkerCreateDispatchError(payload, err).catch(
        (publishErr) => {
          console.error('Failed to publish worker creation dispatch error:', {
            workerId: payload.worker_id,
            accountId: payload.account_id,
            error:
              publishErr instanceof Error
                ? publishErr.message
                : String(publishErr),
          });
        }
      );
    });
  }

  private async publishWorkerCreateDispatchError(
    payload: IWorkerPayload,
    error: unknown
  ): Promise<void> {
    console.error('Failed to dispatch worker creation:', {
      workerId: payload.worker_id,
      accountId: payload.account_id,
      serverId: payload.server_id,
      error: error instanceof Error ? error.message : String(error),
    });

    await this.workerService.updateWorkerById(payload.account_id, {
      worker_id: payload.worker_id,
      worker_status_id: EWorkerStatus.error,
    });

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payload.account_id),
      {
        ...payload,
        worker_status_id: EWorkerStatus.error,
      }
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateWorkerRequest
  ): Promise<boolean> {
    await this.validate(t, accountId);

    let serverId: string;

    if (input.server_id) {
      const eligibleServers = await this.workerService.listWorkerServers();
      const serverEligible = eligibleServers.some(
        (s) => s.server_id === input.server_id
      );

      if (!serverEligible) {
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = input.server_id;
    } else {
      const viewWorkerServer =
        await this.workerService.viewWorkerServer(accountId);

      if (!viewWorkerServer?.server_id) {
        throw new Error(t('worker_server_not_disponible'));
      }

      serverId = viewWorkerServer.server_id;
    }

    const workerType =
      (input.worker_type as EWorkerType) ?? EWorkerType.baileys;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new Error(t('worker_name_required'));
    }

    const workerId = uuidv7();

    const createWorkerPayload: ICreateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
    };

    const isCreated =
      await this.workerService.createWorker(createWorkerPayload);

    if (!isCreated) {
      throw new Error(t('worker_creation_failed'));
    }

    await Promise.all([
      this.workerConfigService.ensureTypingSimulationDefault(workerId),
      this.workerConfigService.ensureSecurityKeyDefault(workerId),
    ]);

    const payloadCreate: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.creating,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payloadCreate.account_id),
      payloadCreate
    );

    this.dispatchWorkerCreated(t, payloadCreate);

    return isCreated;
  }
}
