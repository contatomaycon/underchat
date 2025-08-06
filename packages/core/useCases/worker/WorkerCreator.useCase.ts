import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { AccountService } from '@core/services/account.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { v4 as uuidv4 } from 'uuid';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';

@injectable()
export class WorkerCreatorUseCase {
  constructor(
    private readonly workerService: WorkerService,
    private readonly accountService: AccountService,
    private readonly streamProducerService: StreamProducerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService
  ) {}

  private queueCentrifugo(data: IWorkerPayload): string {
    return `worker.${data.account_id}`;
  }

  private async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ) {
    const existsAccountById =
      await this.accountService.existsAccountById(accountId);

    if (!existsAccountById) {
      throw new Error(t('account_not_found'));
    }

    const [viewAccountQuantityProduct, totalWorkerByAccountId] =
      await Promise.all([
        this.accountService.viewAccountQuantityProduct(
          accountId,
          EPlanProduct.worker
        ),
        this.workerService.totalWorkerByAccountId(accountId),
      ]);

    if (viewAccountQuantityProduct <= 0) {
      throw new Error(t('worker_not_available'));
    }

    if (totalWorkerByAccountId >= viewAccountQuantityProduct) {
      throw new Error(t('worker_not_available_additional'));
    }
  }

  private async onWorkerCreated(
    t: TFunction<'translation', undefined>,
    payload: IWorkerPayload
  ): Promise<void> {
    try {
      await this.streamProducerService.send(
        this.kafkaBalanceQueueService.worker(payload.server_id),
        payload
      );
    } catch {
      throw new Error(t('kafka_error'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    input: CreateWorkerRequest
  ): Promise<boolean> {
    await this.validate(t, accountId);

    const viewWorkerServer =
      await this.workerService.viewWorkerServer(accountId);

    if (!viewWorkerServer) {
      throw new Error(t('worker_server_not_disponible'));
    }

    const workerId = uuidv4();
    const workerType = input.worker_type as EWorkerType;

    const createWorkerPayload: ICreateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.new,
      worker_type_id: workerType,
      server_id: viewWorkerServer.server_id,
      account_id: accountId,
      name: input.name,
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
      server_id: viewWorkerServer.server_id,
      account_id: viewWorkerServer.account_id,
      name: input.name,
      is_administrator: isAdministrator,
    };

    await this.centrifugoService.publish(
      this.queueCentrifugo(payloadCreate),
      payloadCreate
    );

    await this.onWorkerCreated(t, payloadCreate);

    return isCreated;
  }
}
