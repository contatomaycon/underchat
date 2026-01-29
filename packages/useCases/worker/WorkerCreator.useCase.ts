import { injectable } from 'tsyringe';
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

@injectable()
export class WorkerCreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly centrifugoService: CentrifugoService,
    private readonly planAccountService: PlanAccountService,
    private readonly workerGrpcClientService: WorkerGrpcClientService
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

    const workerType = input.worker_type as EWorkerType;
    if (!workerType || !Object.values(EWorkerType).includes(workerType)) {
      throw new Error(t('worker_type_invalid'));
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new Error(t('worker_name_required'));
    }

    const workerId = uuidv7();

    const createWorkerPayload: ICreateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.new,
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

    const payloadCreate: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      worker_status_id: EWorkerStatus.new,
      worker_type_id: workerType,
      server_id: serverId,
      account_id: accountId,
      name: input.name.trim(),
    };

    await this.centrifugoService.publishSub(
      workerCentrifugoQueue(payloadCreate.account_id),
      payloadCreate
    );

    await this.onWorkerCreated(t, payloadCreate);

    await this.workerService.updateWorkerById(accountId, {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.disponible,
    });

    return isCreated;
  }
}
