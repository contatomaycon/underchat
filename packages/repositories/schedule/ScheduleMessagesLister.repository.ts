import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { ScheduleMessageResult } from '@core/schema/schedule/listScheduleMessages/response.schema';

@injectable()
export class ScheduleMessagesListerRepository {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  listScheduleMessages = async (
    scheduleId: string,
    accountId: string,
    currentPage: number,
    perPage: number
  ): Promise<[ScheduleMessageResult[], number]> => {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const queryElastic = {
      from: (currentPage - 1) * perPage,
      size: perPage,
      sort: [{ send_date: { order: 'desc' } }],
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              term: {
                schedule_id: scheduleId,
              },
            },
          ],
        },
      },
    };

    const result =
      await this.elasticDatabaseService.select<ScheduleMessageResult>(
        EElasticIndex.schedule,
        queryElastic
      );

    if (!result) {
      return [[], 0];
    }

    const total = result.hits.total as { value: number; relation: string };
    const messages = result.hits.hits.map(
      (hit) => hit._source
    ) as ScheduleMessageResult[];

    return [messages, total.value];
  };
}
