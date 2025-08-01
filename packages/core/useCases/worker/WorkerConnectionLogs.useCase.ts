import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import { WorkerConnectionLogsResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

@injectable()
export class WorkerConnectionLogsUseCase {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly workerService: WorkerService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    workerId: string,
    query: WorkerConnectionLogsQuery
  ): Promise<WorkerConnectionLogsResponse[]> {
    const exists = await this.workerService.existsWorkerById(
      isAdministrator,
      accountId,
      workerId
    );

    if (!exists) {
      throw new Error(t('worker_not_found'));
    }

    const from = query.from ?? 0;
    const size = query.size ?? 100;
    const sort = query.sort ?? ESortOrder.desc;

    const queryElastic = {
      from: from,
      size: size,
      sort: [{ date: sort }],
      query: {
        term: { worker_id: workerId },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.wpp_connection,
      queryElastic
    );

    if (!result) {
      return [];
    }

    return result.hits.hits.map(
      (hit) => hit._source
    ) as WorkerConnectionLogsResponse[];
  }
}
