import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { WorkerService } from '@core/services/worker.service';
import { SectorService } from '@core/services/sector.service';

@injectable()
export class ViewAttendanceHoursUseCase {
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
  ): Promise<{
    attendance_hours: Awaited<
      ReturnType<WorkerConfigService['viewAttendanceHours']>
    >['attendance_hours'];
    outside_hours_message: string | null;
    available_sectors: Array<{
      id: string;
      name: string;
      color: string | null;
    }>;
    enabled: boolean;
  }> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!existsWorkerById) {
      throw new Error(t('worker_not_found'));
    }

    const [attendanceConfig, sectors] = await Promise.all([
      this.workerConfigService.viewAttendanceHours(workerId),
      this.sectorService.listSectorsForTransfer(accountId),
    ]);

    return {
      attendance_hours: attendanceConfig.attendance_hours,
      outside_hours_message: attendanceConfig.outside_hours_message,
      enabled: attendanceConfig.enabled,
      available_sectors: sectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        color: sector.color ?? null,
      })),
    };
  }
}
