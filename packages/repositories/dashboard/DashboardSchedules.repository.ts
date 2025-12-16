import { inject, injectable } from 'tsyringe';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanAccountUpdaterRepository } from '@core/repositories/planAccount/PlanAccountUpdater.repository';

@injectable()
export class DashboardSchedulesRepository {
  constructor(
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository,
    private readonly planAccountUpdaterRepository: PlanAccountUpdaterRepository
  ) {}

  getSchedulesSent = async (accountId: string): Promise<number> => {
    return this.getSchedulesSentMonthly(accountId);
  };

  getSchedulesAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.mass_sending
    );
  };

  getSchedulesRenewalDate = async (
    accountId: string
  ): Promise<{ day: number; month: number } | null> => {
    const planAccount =
      await this.planAccountUpdaterRepository.findPlanAccountByAccountId(
        accountId
      );

    if (!planAccount?.last_payment_date) {
      return null;
    }

    const paymentDate = new Date(planAccount.last_payment_date);
    const paymentDay = paymentDate.getDate();

    const now = new Date();
    const nextRenewalDate = new Date(now);
    nextRenewalDate.setMonth(nextRenewalDate.getMonth() + 1);
    nextRenewalDate.setDate(paymentDay);
    nextRenewalDate.setHours(0, 0, 0, 0);

    return {
      day: nextRenewalDate.getDate(),
      month: nextRenewalDate.getMonth(),
    };
  };

  private readonly calculateMonthlyPeriod = (
    lastPaymentDate: string | null
  ): { startDate: Date; endDate: Date } => {
    const now = new Date();

    if (!lastPaymentDate) {
      const startDate = new Date(now);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);

      return { startDate, endDate };
    }

    const paymentDate = new Date(lastPaymentDate);
    const paymentDay = paymentDate.getDate();

    const startDate = new Date(now);
    startDate.setDate(paymentDay);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    return { startDate, endDate };
  };

  getSchedulesSentMonthly = async (accountId: string): Promise<number> => {
    const planAccount =
      await this.planAccountUpdaterRepository.findPlanAccountByAccountId(
        accountId
      );

    const { startDate, endDate } = this.calculateMonthlyPeriod(
      planAccount?.last_payment_date ?? null
    );

    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const query = {
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
              term: {
                status: EScheduleStatus.sent,
              },
            },
          ],
          filter: [
            {
              range: {
                send_date: {
                  gte: startDate.toISOString(),
                  lte: endDate.toISOString(),
                },
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      hits: { total: { value: number } | number };
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return 0;
    }

    const total = result.hits.total as { value: number } | number;

    if (typeof total === 'number') {
      return total;
    }

    return total.value;
  };
}
