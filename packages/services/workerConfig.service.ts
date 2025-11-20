import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { workerConfig } from '@core/models';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { WorkerConfigUpserterRepository } from '@core/repositories/worker/WorkerConfigUpserter.repository';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';

@injectable()
export class WorkerConfigService {
  constructor(
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    private readonly workerConfigUpserterRepository: WorkerConfigUpserterRepository
  ) {}

  async viewWorkerConfig(workerId: string): Promise<ViewWorkerConfigResponse> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return this.mapToWorkerConfig(result);
  }

  async upsertWorkerConfig(
    t: TFunction<'translation', undefined>,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<WorkerConfig> {
    await this.workerConfigUpserterRepository.upsertWorkerConfig(
      workerId,
      input
    );

    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      throw new Error(t('worker_config_not_found'));
    }

    return this.mapToWorkerConfig(result);
  }

  private mapToWorkerConfig(
    result: typeof workerConfig.$inferSelect
  ): WorkerConfig {
    return {
      worker_config_id: result.worker_config_id,
      worker_id: result.worker_id,
      is_automatic_attendance: result.is_automatic_attendance ?? false,
      show_attendee_name: result.show_attendee_name ?? false,
      show_worker_name: result.show_worker_name ?? false,
      generate_protocol_at_ura: result.generate_protocol_at_ura ?? false,
      generate_protocol_at_start: result.generate_protocol_at_start ?? false,
      generate_protocol_at_transfer:
        result.generate_protocol_at_transfer ?? false,
      created_at: result.created_at ?? null,
      updated_at: result.updated_at ?? null,
    };
  }
}
