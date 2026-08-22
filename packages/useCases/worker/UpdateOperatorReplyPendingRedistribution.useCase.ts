import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { IOperatorReplyPendingRedistributionConfig } from '@core/common/interfaces/IOperatorReplyPendingRedistributionConfig';
import { UpdateOperatorReplyPendingRedistributionRequest } from '@core/schema/worker/updateOperatorReplyPendingRedistribution/request.schema';
import { SectorService } from '@core/services/sector.service';
import { normalizeOperatorReplyPendingRedistributionSectorIds } from '@core/common/functions/operatorReplyPendingRedistributionConfig';

@injectable()
export class UpdateOperatorReplyPendingRedistributionUseCase {
  constructor(
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(SectorService)
    private readonly sectorService: SectorService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UpdateOperatorReplyPendingRedistributionRequest
  ): Promise<IOperatorReplyPendingRedistributionConfig> {
    const workerExists = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!workerExists) {
      throw new Error(t('worker_not_found'));
    }

    if (!Number.isInteger(body.time_minutes) || body.time_minutes < 1) {
      throw new Error(t('operator_reply_pending_redistribution_invalid_time'));
    }

    const currentConfig =
      body.sector_ids === undefined
        ? await this.workerConfigService.viewOperatorReplyPendingRedistribution(
            workerId
          )
        : null;
    const sectorIds = normalizeOperatorReplyPendingRedistributionSectorIds(
      body.sector_ids ?? currentConfig?.sector_ids
    );

    if (sectorIds.length > 0) {
      const availableSectors =
        await this.sectorService.listSectorsForTransfer(accountId);
      const availableSectorIds = new Set(
        availableSectors.map((sector) => sector.id)
      );

      if (sectorIds.some((sectorId) => !availableSectorIds.has(sectorId))) {
        throw new Error(t('sector_not_found'));
      }
    }

    return this.workerConfigService.updateOperatorReplyPendingRedistribution(
      workerId,
      {
        enabled: body.enabled,
        time_minutes: body.time_minutes,
        sector_ids: sectorIds,
      }
    );
  }
}
