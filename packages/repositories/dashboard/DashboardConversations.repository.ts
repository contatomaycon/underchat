import { injectable, inject } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { IConversationEvolution } from '@core/common/interfaces/IConversationEvolution';

@injectable()
export class DashboardConversationsRepository {
  constructor(
    @inject(ElasticDatabaseService)
    private readonly elasticDatabaseService: ElasticDatabaseService
  ) {}

  getActiveChatsCount = async (accountId: string): Promise<number> => {
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
                status: EChatStatus.in_chat,
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
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  getClosedChatsCount = async (accountId: string): Promise<number> => {
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
    };

    const result = await this.elasticDatabaseService.select(
      EElasticIndex.chat,
      queryElastic
    );

    const total = result?.hits?.total;
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };

  getConversationsEvolution = async (
    accountId: string
  ): Promise<IConversationEvolution[]> => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    currentMonth.setHours(0, 0, 0, 0);

    const months: IConversationEvolution[] = [];

    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(currentMonth);
      monthStart.setMonth(monthStart.getMonth() - i);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const monthName = monthStart.toLocaleDateString('pt-BR', {
        month: 'short',
        year: 'numeric',
      });

      const [activeCount, closedCount] = await Promise.all([
        this.getChatsCountByStatusAndDateRange(
          accountId,
          EChatStatus.in_chat,
          monthStart.toISOString(),
          monthEnd.toISOString()
        ),
        this.getChatsCountByStatusAndDateRange(
          accountId,
          EChatStatus.closed,
          monthStart.toISOString(),
          monthEnd.toISOString()
        ),
      ]);

      months.push({
        month: monthName,
        active: activeCount,
        closed: closedCount,
      });
    }

    return months;
  };

  private readonly getChatsCountByStatusAndDateRange = async (
    accountId: string,
    status: EChatStatus,
    startDate: string,
    endDate: string
  ): Promise<number> => {
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
                status: status,
              },
            },
            {
              range: {
                started_at: {
                  gte: startDate,
                  lt: endDate,
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
    if (typeof total === 'number') {
      return total;
    }

    return total?.value ?? 0;
  };
}
