import { container, injectable, inject } from 'tsyringe';
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
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerWarmPoolSettingsService } from '@core/services/workerWarmPoolSettings.service';
import { currentTime } from '@core/common/functions/currentTime';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { logger } from '@core/plugins/telemetry/logger';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';

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
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerWarmPoolSettingsService)
    private readonly workerWarmPoolSettingsService: WorkerWarmPoolSettingsService,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never
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

  private async publishWarmReplenish(
    serverId: string,
    workerType: EWorkerType,
    reason: 'claim_replenish' | 'pool_miss'
  ): Promise<void> {
    try {
      const { WorkerWarmPoolQueueService } =
        await import('@core/services/workerWarmPoolQueue.service');
      const queueService = container.resolve(WorkerWarmPoolQueueService);
      await queueService.publishReplenish({
        request_id: uuidv7(),
        server_id: serverId,
        worker_type_id: workerType,
        reason,
        requested_at: currentTime(),
      });
    } catch (error) {
      logger.error(
        {
          type: 'warm_pool.replenish.error',
          server_id: serverId,
          worker_type_id: workerType,
          reason,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to enqueue warm worker replenish'
      );
    }
  }

  private async tryClaimWarmWorker(
    payload: IWorkerPayload,
    settings: IWorkerWarmPoolSettings
  ): Promise<ICreateWorkerResponse | null> {
    if (!payload.worker_type_id || !this.workerWarmPoolRepository) {
      return null;
    }

    await this.workerWarmPoolRepository.releaseExpiredReservations();
    const reservationExpiresAt = new Date(
      Date.now() + settings.reservation_ttl_seconds * 1000
    ).toISOString();
    const warm = await this.workerWarmPoolRepository.reserveReady(
      payload.server_id,
      payload.worker_type_id,
      payload.worker_id,
      reservationExpiresAt
    );

    if (!warm) {
      logger.warn(
        {
          type: 'warm_pool.miss',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
        },
        'Warm worker pool miss'
      );
      if (settings.warmup_enabled) {
        await this.publishWarmReplenish(
          payload.server_id,
          payload.worker_type_id,
          'pool_miss'
        );
      }
      return null;
    }

    try {
      const response = await this.workerGrpcClientService.activateWarmWorker(
        payload.server_id,
        {
          warm_pool_id: warm.warm_pool_id,
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
        },
        60_000
      );

      if (settings.warmup_enabled) {
        await this.publishWarmReplenish(
          payload.server_id,
          payload.worker_type_id,
          'claim_replenish'
        );
      }

      logger.info(
        {
          type: 'warm_pool.claim',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          warm_pool_id: warm.warm_pool_id,
          container_id: response.container_id,
          session_volume_name: response.session_volume_name,
        },
        'Warm worker claimed'
      );

      return {
        worker_id: payload.worker_id,
        server_id: payload.server_id,
        worker_type_id: payload.worker_type_id,
        warm_pool_claimed: true,
        warm_pool_id: warm.warm_pool_id,
      };
    } catch (error) {
      logger.error(
        {
          type: 'warm_pool.activate.error',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          server_id: payload.server_id,
          worker_type_id: payload.worker_type_id,
          warm_pool_id: warm.warm_pool_id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Warm worker activation failed; falling back to normal create'
      );

      try {
        await this.workerGrpcClientService.deleteWarmWorker(
          payload.server_id,
          {
            request_id: uuidv7(),
            warm_pool_id: warm.warm_pool_id,
            server_id: payload.server_id,
            worker_type_id: payload.worker_type_id,
            container_id: warm.container_id ?? undefined,
            container_name: warm.container_name ?? undefined,
            session_volume_name: warm.session_volume_name ?? undefined,
            remove_volume: true,
            reason: 'pool_reconcile',
            requested_at: currentTime(),
          },
          60_000
        );
      } catch (deleteError) {
        logger.error(
          {
            type: 'warm_pool.delete.error',
            worker_id: payload.worker_id,
            account_id: payload.account_id,
            server_id: payload.server_id,
            worker_type_id: payload.worker_type_id,
            warm_pool_id: warm.warm_pool_id,
            error:
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
          },
          'Failed to delete failed warm worker'
        );
      }
      if (settings.warmup_enabled) {
        await this.publishWarmReplenish(
          payload.server_id,
          payload.worker_type_id,
          'pool_miss'
        );
      }
      return null;
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    input: CreateWorkerRequest
  ): Promise<ICreateWorkerResponse> {
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

    const warmSettings = await this.workerWarmPoolSettingsService.view();
    const warmClaim = await this.tryClaimWarmWorker(
      payloadCreate,
      warmSettings
    );
    if (warmClaim) {
      return warmClaim;
    }

    this.dispatchWorkerCreated(t, payloadCreate);

    return {
      worker_id: workerId,
      server_id: serverId,
      worker_type_id: workerType,
      fallback_created: warmSettings.warmup_enabled,
    };
  }
}
