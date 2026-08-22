import { inject, injectable } from 'tsyringe';
import type { TFunction } from 'i18next';
import { ConfigService } from '@core/services/config.service';
import { WorkerConnectionLogsUseCase } from '@core/useCases/worker/WorkerConnectionLogs.useCase';
import type { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';

@injectable()
export class ConfigChannelConnectionHealthUseCase {
  constructor(
    @inject(ConfigService)
    private readonly configService: ConfigService,
    @inject(WorkerConnectionLogsUseCase)
    private readonly workerConnectionLogsUseCase: WorkerConnectionLogsUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    channelId: string,
    query: WorkerConnectionLogsQuery
  ): Promise<WorkerConnectionHealthResponse> {
    const channelContext =
      await this.configService.viewChannelContext(channelId);

    if (!channelContext) {
      throw new Error(t('worker_not_found'));
    }

    return this.workerConnectionLogsUseCase.execute(
      t,
      channelContext.account_id,
      channelId,
      query
    );
  }
}
