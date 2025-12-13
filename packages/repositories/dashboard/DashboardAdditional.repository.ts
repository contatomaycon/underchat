import * as schema from '@core/models';
import {
  contact,
  chatbot,
  contactGroup,
  messageTemplate,
  labelTemplate,
  sector,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, gte, lt, asc } from 'drizzle-orm';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

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
  ): Promise<Array<{ day: string; performed: number; average: number }>> => {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const dayNames = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

    const historicalQuery = {
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
                  lt: now.toISOString(),
                },
              },
            },
          ],
        },
      },
      _source: ['closed_at'],
    };

    const historicalResult = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      historicalQuery
    );

    const historicalChats =
      historicalResult?.hits?.hits?.map((hit: any) => hit._source) || [];

    const uniqueDates = new Set<string>();
    for (const chat of historicalChats) {
      if (chat.closed_at) {
        const chatDate = new Date(chat.closed_at);
        const dateKey = chatDate.toISOString().split('T')[0];
        uniqueDates.add(dateKey);
      }
    }

    const dateQueries = Array.from(uniqueDates).map((dateKey) => {
      const dayStart = new Date(dateKey);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      return {
        dateKey,
        query: {
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
                      gte: dayStart.toISOString(),
                      lt: dayEnd.toISOString(),
                    },
                  },
                },
              ],
            },
          },
        },
      };
    });

    const dateResults = await Promise.all(
      dateQueries.map(async ({ dateKey, query }) => {
        const dayResult = await this.elasticDatabaseService.select(
          EElasticIndex.chat,
          query
        );
        const dayTotal = dayResult?.hits?.total;
        const dayCount =
          typeof dayTotal === 'number' ? dayTotal : (dayTotal?.value ?? 0);
        return { dateKey, count: dayCount };
      })
    );

    const dayCountsByDate: Record<string, number> = {};
    for (const { dateKey, count } of dateResults) {
      dayCountsByDate[dateKey] = count;
    }

    const averagesByWeekday: Record<number, number[]> = {
      0: [],
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
    };

    for (const [dateKey, count] of Object.entries(dayCountsByDate)) {
      const date = new Date(dateKey);
      const dayOfWeek = date.getDay();
      averagesByWeekday[dayOfWeek].push(count);
    }

    const finalAverages: Record<number, number> = {};
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const counts = averagesByWeekday[dayOfWeek];
      finalAverages[dayOfWeek] =
        counts.length > 0
          ? Math.round(
              counts.reduce((sum, count) => sum + count, 0) / counts.length
            )
          : 0;
    }

    const dayPromises = Array.from({ length: 7 }, async (_, i) => {
      const date = new Date(sevenDaysAgo);
      date.setDate(date.getDate() + i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const dayName = dayNames[date.getDay()];
      const dayOfWeek = date.getDay();

      const queryElasticPerformed = {
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

      const resultPerformed = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        queryElasticPerformed
      );

      const totalPerformed = resultPerformed?.hits?.total;
      const performed =
        typeof totalPerformed === 'number'
          ? totalPerformed
          : (totalPerformed?.value ?? 0);

      return {
        day: dayName,
        performed,
        average: finalAverages[dayOfWeek] || 0,
      };
    });

    return Promise.all(dayPromises);
  };

  getSectorsDistribution = async (
    accountId: string
  ): Promise<
    Array<{ sectorId: string; sectorName: string; count: number }>
  > => {
    const allSectors = await this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
      })
      .from(sector)
      .where(
        and(
          eq(sector.account_id, accountId),
          isNull(sector.deleted_at),
          eq(sector.sector_status_id, ESectorStatus.active)
        )
      )
      .orderBy(asc(sector.name))
      .execute();

    const sectorCountPromises = allSectors.map(async (sectorItem) => {
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
                nested: {
                  path: 'sector',
                  query: {
                    term: {
                      'sector.id': sectorItem.sector_id,
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
      };

      const result = await this.elasticDatabaseService.select(
        EElasticIndex.chat,
        queryElastic
      );

      const total = result?.hits?.total;
      const count =
        typeof total === 'number' ? total : (total?.value ?? 0);

      return {
        sectorId: sectorItem.sector_id,
        sectorName: sectorItem.name,
        count,
      };
    });

    const sectors = await Promise.all(sectorCountPromises);

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
