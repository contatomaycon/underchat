import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';

@injectable()
export class DashboardAttendanceRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>,
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

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

  private readonly formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  private readonly calculateResponseTime = (
    date: number | null,
    startedAt: number | null
  ): number | null => {
    if (!date || !startedAt) {
      return null;
    }

    const responseTime = Math.floor((startedAt - date) / 1000);
    return responseTime > 0 ? responseTime : null;
  };

  private readonly calculateResolutionTime = (
    startedAt: number | null,
    closedAt: number | null
  ): number | null => {
    if (!startedAt || !closedAt) {
      return null;
    }

    const resolutionTime = Math.floor((closedAt - startedAt) / 1000);
    return resolutionTime > 0 ? resolutionTime : null;
  };

  private readonly processChatTimes = (
    chats: any[]
  ): {
    totalResponseTime: number;
    totalResolutionTime: number;
    responseCount: number;
    resolutionCount: number;
  } => {
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

      const responseTime = this.calculateResponseTime(date, startedAt);
      if (responseTime !== null) {
        totalResponseTime += responseTime;
        responseCount++;
      }

      const resolutionTime = this.calculateResolutionTime(startedAt, closedAt);
      if (resolutionTime !== null) {
        totalResolutionTime += resolutionTime;
        resolutionCount++;
      }
    }

    return {
      totalResponseTime,
      totalResolutionTime,
      responseCount,
      resolutionCount,
    };
  };

  private readonly calculateAverage = (
    total: number,
    count: number
  ): number => {
    return count > 0 ? Math.floor(total / count) : 0;
  };

  private readonly getAverageAttendancesPerUser = async (): Promise<number> => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const queryElastic = {
      size: 0,
      query: {
        bool: {
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
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const total = result?.hits?.total;
    const totalAttendancesAll =
      typeof total === 'number' ? total : (total?.value ?? 0);

    const usersResult = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(isNull(user.deleted_at))
      .execute();

    const totalUsersAll = usersResult[0]?.total ?? 0;

    if (totalUsersAll === 0) {
      return 0;
    }

    return totalAttendancesAll / totalUsersAll;
  };

  private readonly calculateProductivity = async (
    totalAttendances: number,
    totalUsers: number
  ): Promise<number> => {
    if (totalAttendances === 0 || totalUsers === 0) {
      return 0;
    }

    const averagePerUser = await this.getAverageAttendancesPerUser();

    if (averagePerUser === 0) {
      return 0;
    }

    const expectedAttendances = totalUsers * averagePerUser;
    const productivity = Math.min(
      100,
      Math.floor((totalAttendances / expectedAttendances) * 100)
    );

    return productivity;
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

    const {
      totalResponseTime,
      totalResolutionTime,
      responseCount,
      resolutionCount,
    } = this.processChatTimes(chats);

    const avgResponseSeconds = this.calculateAverage(
      totalResponseTime,
      responseCount
    );
    const avgResolutionSeconds = this.calculateAverage(
      totalResolutionTime,
      resolutionCount
    );

    const totalAttendances = chats.length;

    const usersResult = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(eq(user.account_id, accountId), isNull(user.deleted_at)))
      .execute();

    const totalUsers = usersResult[0]?.total ?? 0;
    const productivity = await this.calculateProductivity(
      totalAttendances,
      totalUsers
    );

    return {
      avgResponseTime: this.formatTime(avgResponseSeconds),
      avgResolutionTime: this.formatTime(avgResolutionSeconds),
      totalAttendances,
      productivity,
    };
  };
}
