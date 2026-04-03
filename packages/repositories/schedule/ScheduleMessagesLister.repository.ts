import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { ScheduleMessageResult } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';

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

  countFailedMessagesByScheduleIds = async (
    scheduleIds: string[],
    accountId: string
  ): Promise<Record<string, number>> => {
    if (!scheduleIds.length) {
      return {};
    }

    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const queryElastic = {
      size: 0,
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
              terms: {
                schedule_id: scheduleIds,
              },
            },
            {
              term: {
                status: EScheduleStatus.failed,
              },
            },
          ],
        },
      },
      aggs: {
        by_schedule: {
          terms: {
            field: 'schedule_id',
            size: scheduleIds.length,
          },
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.schedule,
      queryElastic
    );

    if (!result) {
      return {};
    }

    const aggregations = result.aggregations as
      | {
          by_schedule?: {
            buckets?: Array<{ key: string; doc_count: number }>;
          };
        }
      | undefined;

    const buckets = aggregations?.by_schedule?.buckets ?? [];
    const failedBySchedule: Record<string, number> = {};

    for (const bucket of buckets) {
      failedBySchedule[bucket.key] = bucket.doc_count;
    }

    return failedBySchedule;
  };
}
