import * as schema from '@core/models';
import { userCustomer } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

@injectable()
export class UserCustomerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  getUserCustomerByUserId = async (
    userId: string
  ): Promise<{ user_customer_id: string; user_customer: string } | null> => {
    const result = await this.dbRw.query.userCustomer.findFirst({
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

    await this.dbRw.insert(userCustomer).values({
      user_customer_id: userCustomerId,
      user_id: userId,
      user_customer: customerId,
    });

    return {
      user_customer_id: userCustomerId,
      user_customer: customerId,
    };
  };

  updateUserCustomerByUserId = async (
    userId: string,
    customerId: string
  ): Promise<{ user_customer_id: string; user_customer: string }> => {
    const result = await this.dbRw
      .update(userCustomer)
      .set({
        user_customer: customerId,
        updated_at: new Date().toISOString(),
      })
      .where(eq(userCustomer.user_id, userId))
      .returning({
        user_customer_id: userCustomer.user_customer_id,
        user_customer: userCustomer.user_customer,
      });

    if (!result[0]) {
      throw new Error('User customer not found');
    }

    return {
      user_customer_id: result[0].user_customer_id,
      user_customer: result[0].user_customer,
    };
  };
}
