import * as schema from '@core/models';
import {
  contact,
  chatbot,
  contactGroup,
  messageTemplate,
  labelTemplate,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, gte, lt } from 'drizzle-orm';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';

@injectable()
export class DashboardAdditionalRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  getContactsGrowthMonthly = async (
    accountId: string
  ): Promise<Array<{ month: string; total: number }>> => {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const monthPromises = Array.from({ length: 12 }, async (_, index) => {
      const i = 11 - index;
      const monthStart = new Date(currentMonth);
      monthStart.setMonth(monthStart.getMonth() - i);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const monthName = monthStart.toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
      });

      const cumulativeResult = await this.db
        .select({
          total: count(),
        })
        .from(contact)
        .where(
          and(
            eq(contact.account_id, accountId),
            isNull(contact.deleted_at),
            lt(contact.created_at, monthEnd.toISOString())
          )
        )
        .execute();

      return {
        month: monthName,
        total: cumulativeResult[0]?.total ?? 0,
      };
    });

    return Promise.all(monthPromises);
  };

  getAttendancePerformance = async (
    accountId: string
  ): Promise<Array<{ day: string; performed: number; goal: number }>> => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

    const dayPromises = Array.from({ length: 7 }, async (_, i) => {
      const date = new Date(sevenDaysAgo);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayName = dayNames[date.getDay()];

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
            ],
            filter: [
              {
                term: {
                  status: EChatStatus.closed,
                },
              },
              {
                range: {
                  closed_at: {
                    gte: date.toISOString(),
                    lt: nextDate.toISOString(),
                  },
                },
              },
            ],
          },
        },
      };

      const result = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        queryElastic
      );

      const total = result?.hits?.total;
      const performed = typeof total === 'number' ? total : (total?.value ?? 0);

      return {
        day: dayName,
        performed,
        goal: 200,
      };
    });

    return Promise.all(dayPromises);
  };

  getSectorsDistribution = async (
    accountId: string
  ): Promise<
    Array<{ sectorId: string; sectorName: string; count: number }>
  > => {
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
          ],
          filter: [
            {
              term: {
                status: EChatStatus.closed,
              },
            },
          ],
        },
      },
      aggs: {
        sectors: {
          nested: {
            path: 'sector',
          },
          aggs: {
            sector_names: {
              terms: {
                field: 'sector.id',
                size: 100,
              },
              aggs: {
                sector_name: {
                  terms: {
                    field: 'sector.name',
                    size: 1,
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const sectors: Array<{
      sectorId: string;
      sectorName: string;
      count: number;
    }> = [];

    const aggregations = result?.aggregations as any;
    if (aggregations?.sectors?.sector_names?.buckets) {
      for (const bucket of aggregations.sectors.sector_names.buckets) {
        const sectorNameBucket = bucket.sector_name?.buckets?.[0];
        sectors.push({
          sectorId: bucket.key as string,
          sectorName: (sectorNameBucket?.key as string) || 'Sem Setor',
          count: bucket.doc_count,
        });
      }
    }

    const noSectorQuery = {
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
          ],
          filter: [
            {
              term: {
                status: EChatStatus.closed,
              },
            },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'sector',
                  },
                },
              },
            },
          ],
        },
      },
    };

    const noSectorResult = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      noSectorQuery
    );

    const noSectorTotal = noSectorResult?.hits?.total;
    const noSectorCount =
      typeof noSectorTotal === 'number'
        ? noSectorTotal
        : (noSectorTotal?.value ?? 0);

    if (noSectorCount > 0) {
      sectors.push({
        sectorId: 'no-sector',
        sectorName: 'Sem Setor',
        count: noSectorCount,
      });
    }

    return sectors;
  };

  getAttendanceMetrics = async (
    accountId: string
  ): Promise<{
    avgResponseTime: string;
    avgResolutionTime: string;
    totalAttendances: number;
    productivity: number;
  }> => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const queryElastic = {
      size: 10000,
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
          ],
          filter: [
            {
              term: {
                status: EChatStatus.closed,
              },
            },
            {
              range: {
                closed_at: {
                  gte: thirtyDaysAgo.toISOString(),
                },
              },
            },
          ],
        },
      },
      _source: ['date', 'started_at', 'closed_at'],
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const chats = result?.hits?.hits?.map((hit: any) => hit._source) || [];

    let totalResponseTime = 0;
    let totalResolutionTime = 0;
    let responseCount = 0;
    let resolutionCount = 0;

    for (const chat of chats) {
      const date = chat.date ? new Date(chat.date).getTime() : null;
      const startedAt = chat.started_at
        ? new Date(chat.started_at).getTime()
        : null;
      const closedAt = chat.closed_at
        ? new Date(chat.closed_at).getTime()
        : null;

      if (date && startedAt) {
        const responseTime = Math.floor((startedAt - date) / 1000);
        if (responseTime > 0) {
          totalResponseTime += responseTime;
          responseCount++;
        }
      }

      if (startedAt && closedAt) {
        const resolutionTime = Math.floor((closedAt - startedAt) / 1000);
        if (resolutionTime > 0) {
          totalResolutionTime += resolutionTime;
          resolutionCount++;
        }
      }
    }

    const avgResponseSeconds =
      responseCount > 0 ? Math.floor(totalResponseTime / responseCount) : 0;
    const avgResolutionSeconds =
      resolutionCount > 0
        ? Math.floor(totalResolutionTime / resolutionCount)
        : 0;

    const formatTime = (seconds: number): string => {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes}m ${secs}s`;
    };

    const totalAttendances = chats.length;
    const productivity =
      totalAttendances > 0
        ? Math.min(100, Math.floor((totalAttendances / 1500) * 100))
        : 0;

    return {
      avgResponseTime: formatTime(avgResponseSeconds),
      avgResolutionTime: formatTime(avgResolutionSeconds),
      totalAttendances,
      productivity,
    };
  };

  getChatbotsTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(eq(chatbot.account_id, accountId))
      .execute();

    return result[0]?.total ?? 0;
  };

  getChatbotsActive = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(chatbot)
      .where(eq(chatbot.account_id, accountId))
      .execute();

    return result[0]?.total ?? 0;
  };

  getContactGroupsTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(contactGroup)
      .where(
        and(
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getMessageTemplatesTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(messageTemplate)
      .where(
        and(
          eq(messageTemplate.account_id, accountId),
          isNull(messageTemplate.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getLabelTemplatesTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };
}
