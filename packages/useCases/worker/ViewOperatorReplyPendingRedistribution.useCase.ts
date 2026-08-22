import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { IOperatorReplyPendingRedistributionConfig } from '@core/common/interfaces/IOperatorReplyPendingRedistributionConfig';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class ViewOperatorReplyPendingRedistributionUseCase {
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
    workerId: string
  ): Promise<
    IOperatorReplyPendingRedistributionConfig & {
      available_sectors: Array<{
        id: string;
        name: string;
        color: string | null;
      }>;
    }
  > {
    const workerExists = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!workerExists) {
      throw new Error(t('worker_not_found'));
    }

    const [config, sectors] = await Promise.all([
      this.workerConfigService.viewOperatorReplyPendingRedistribution(workerId),
      this.sectorService.listSectorsForTransfer(accountId),
    ]);

    return {
      ...config,
      available_sectors: sectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        color: sector.color ?? null,
      })),
    };
  }
}
