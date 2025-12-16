import * as schema from '@core/models';
import { user, worker, contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull, sql, gte, lt } from 'drizzle-orm';
import { AccountQuantityProductViewerRepository } from '@core/repositories/account/AccountQuantityProductViewer.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class DashboardStatsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>,
    private readonly accountQuantityProductViewerRepository: AccountQuantityProductViewerRepository
  ) {}

  getUsersTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(user)
      .where(and(eq(user.account_id, accountId), isNull(user.deleted_at)))
      .execute();

    const total = result[0]?.total ?? 0;
    return total > 0 ? total - 1 : 0;
  };

  getUsersSparklineData = async (accountId: string): Promise<number[]> => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const date = new Date(sevenDaysAgo);
        date.setDate(date.getDate() + index);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const result = await this.db
          .select({
            total: count(),
          })
          .from(user)
          .where(
            and(
              eq(user.account_id, accountId),
              isNull(user.deleted_at),
              lt(user.created_at, nextDate.toISOString())
            )
          )
          .execute();

        return result[0]?.total ?? 0;
      })
    );

    return results;
  };

  getChannelsTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(worker)
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .execute();

    return result[0]?.total ?? 0;
  };

  getChannelsConnected = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(worker)
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          sql`${worker.connection_date} IS NOT NULL`
        )
      )
      .execute();

    return result[0]?.total ?? 0;
  };

  getChannelsSparklineData = async (accountId: string): Promise<number[]> => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const date = new Date(sevenDaysAgo);
        date.setDate(date.getDate() + index);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const result = await this.db
          .select({
            total: count(),
          })
          .from(worker)
          .where(
            and(
              eq(worker.account_id, accountId),
              isNull(worker.deleted_at),
              sql`${worker.connection_date} IS NOT NULL`,
              lt(worker.connection_date, nextDate.toISOString())
            )
          )
          .execute();

        return result[0]?.total ?? 0;
      })
    );

    return results;
  };

  getContactsTotal = async (accountId: string): Promise<number> => {
    const result = await this.db
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

    const result = await this.db
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
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const results = await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const date = new Date(sevenDaysAgo);
        date.setDate(date.getDate() + index);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const result = await this.db
          .select({
            total: count(),
          })
          .from(contact)
          .where(
            and(
              eq(contact.account_id, accountId),
              isNull(contact.deleted_at),
              lt(contact.created_at, nextDate.toISOString())
            )
          )
          .execute();

        return result[0]?.total ?? 0;
      })
    );

    return results;
  };

  getChannelsAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.worker
    );
  };

  getUsersAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.user
    );
  };

  getContactsAllowed = async (accountId: string): Promise<number> => {
    return this.accountQuantityProductViewerRepository.viewAccountQuantityProduct(
      accountId,
      EPlanProduct.contact
    );
  };
}
