import * as schema from '@core/models';
import { userCustomer, user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';

@injectable()
export class UserCustomerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  getUserCustomerByUserId = async (
    userId: string
  ): Promise<{ user_customer_id: string; user_customer: string } | null> => {
    const result = await this.db.query.userCustomer.findFirst({
      where: eq(userCustomer.user_id, userId),
      columns: {
        user_customer_id: true,
        user_customer: true,
      },
    });

    if (!result) {
      return null;
    }

    return {
      user_customer_id: result.user_customer_id,
      user_customer: result.user_customer,
    };
  };

  createUserCustomer = async (
    userId: string,
    customerId: string
  ): Promise<{ user_customer_id: string; user_customer: string }> => {
    const userCustomerId = randomUUID();

    await this.db.insert(userCustomer).values({
      user_customer_id: userCustomerId,
      user_id: userId,
      user_customer: customerId,
    });

    return {
      user_customer_id: userCustomerId,
      user_customer: customerId,
    };
  };

  getFirstUserIdByAccountId = async (
    accountId: string
  ): Promise<string | null> => {
    const result = await this.db.query.user.findFirst({
      where: and(eq(user.account_id, accountId), isNull(user.deleted_at)),
      columns: {
        user_id: true,
      },
      orderBy: (users, { asc }) => [asc(users.created_at)],
    });

    return result?.user_id || null;
  };
}

