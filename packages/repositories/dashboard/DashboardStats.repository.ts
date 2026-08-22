import * as schema from '@core/models';
import {
  user,
  worker,
  contact,
  workerRuntime,
  whatsappSessionLease,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, sql, gte, SQL, notInArray } from 'drizzle-orm';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  effectiveWorkerOnlinePredicate,
  liveWhatsappSessionLeaseJoinCondition,
} from '@core/repositories/worker/workerEffectiveOnline.sql';

@injectable()
export class DashboardStatsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(AccountQuantityProductViewerRepository)
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly getSparklineNextDates = (): Date[] => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, index) => {
      const nextDate = new Date(startDate);
      nextDate.setDate(nextDate.getDate() + index + 1);
      return nextDate;
    });
  };

  getUsersTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(user)
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .execute();

    const total = result[0]?.total ?? 0;
    return total > 0 ? total - 1 : 0;
  };

  getUsersSparklineData = async (accountId: string): Promise<number[]> => {
    const nextDates = this.getSparklineNextDates();
    const selectFields = nextDates.reduce(
      (acc, date, index) => {
        acc[`day_${index + 1}`] = sql<number>`
          COUNT(*) FILTER (WHERE ${user.created_at} < ${date.toISOString()})
        `;
        return acc;
      },
      {} as Record<string, SQL<number>>
    );

    const result = await this.dbRo
      .select(selectFields)
      .from(user)
      .where(
        and(
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .execute();

    const row = result[0] ?? {};
    return nextDates.map((_, index) => Number(row[`day_${index + 1}`] ?? 0));
  };

  getChannelsTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.blocked,
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
            EWorkerStatus.deleting,
          ])
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getChannelsConnected = async (accountId: string): Promise<number> => {
    const result = await this.dbRw
      .select({
        total: count(),
      })
      .from(worker)
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(whatsappSessionLease, liveWhatsappSessionLeaseJoinCondition())
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.blocked,
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
            EWorkerStatus.deleting,
          ]),
          effectiveWorkerOnlinePredicate()
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getChannelsSparklineData = async (accountId: string): Promise<number[]> => {
    const nextDates = this.getSparklineNextDates();
    const selectFields = nextDates.reduce(
      (acc, date, index) => {
        acc[`day_${index + 1}`] = sql<number>`
          COUNT(*) FILTER (WHERE ${worker.connection_date} < ${date.toISOString()})
        `;
        return acc;
      },
      {} as Record<string, SQL<number>>
    );

    const result = await this.dbRo
      .select(selectFields)
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.blocked,
            EWorkerStatus.stopped,
            EWorkerStatus.delete,
            EWorkerStatus.deleting,
          ]),
          sql`${worker.connection_date} IS NOT NULL`
        )
      )
      .execute();

    const row = result[0] ?? {};
    return nextDates.map((_, index) => Number(row[`day_${index + 1}`] ?? 0));
  };

  getContactsTotal = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contact)
      .where(and(eq(contact.account_id, accountId), isNull(contact.deleted_at)))
      .execute();

    return result[0]?.total ?? 0;
  };

  getContactsGrowth = async (accountId: string): Promise<number> => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contact)
      .where(
        and(
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at),
          gte(contact.created_at, thirtyDaysAgo.toISOString())
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getContactsSparklineData = async (accountId: string): Promise<number[]> => {
    const nextDates = this.getSparklineNextDates();
    const selectFields = nextDates.reduce(
      (acc, date, index) => {
        acc[`day_${index + 1}`] = sql<number>`
          COUNT(*) FILTER (WHERE ${contact.created_at} < ${date.toISOString()})
        `;
        return acc;
      },
      {} as Record<string, SQL<number>>
    );

    const result = await this.dbRo
      .select(selectFields)
      .from(contact)
      .where(and(eq(contact.account_id, accountId), isNull(contact.deleted_at)))
      .execute();

    const row = result[0] ?? {};
    return nextDates.map((_, index) => Number(row[`day_${index + 1}`] ?? 0));
  };

  getChannelsAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.worker
    );
  };

  getUsersAllowed = async (accountId: string): Promise<number> => {
    const quantity =
      await this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
        accountId,
        EPlanProduct.user
      );

    return quantity + 1;
  };

  getContactsAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.contact
    );
  };
}
