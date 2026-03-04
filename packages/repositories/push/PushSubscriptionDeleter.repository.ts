import * as schema from '@core/models';
import { pushSubscription } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull } from 'drizzle-orm';

@injectable()
export class PushSubscriptionDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteByEndpoint = async (
    endpoint: string,
    provider?: string
  ): Promise<boolean> => {
    const filter = [eq(pushSubscription.endpoint, endpoint)];
    if (provider) {
      filter.push(eq(pushSubscription.provider, provider));
    }

    const result = await this.dbRw
      .update(pushSubscription)
      .set({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(and(...filter, isNull(pushSubscription.deleted_at)))
      .returning({
        push_subscription_id: pushSubscription.push_subscription_id,
      });

    return result.length > 0;
  };

  deleteByUserId = async (userId: string): Promise<boolean> => {
    const result = await this.dbRw
      .update(pushSubscription)
      .set({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(pushSubscription.user_id, userId),
          isNull(pushSubscription.deleted_at)
        )
      )
      .returning({
        push_subscription_id: pushSubscription.push_subscription_id,
      });

    return result.length > 0;
  };

  deleteByUserAndEndpoint = async (
    userId: string,
    endpoint: string,
    provider?: string
  ): Promise<boolean> => {
    const filter = [
      eq(pushSubscription.user_id, userId),
      eq(pushSubscription.endpoint, endpoint),
    ];

    if (provider) {
      filter.push(eq(pushSubscription.provider, provider));
    }

    const result = await this.dbRw
      .update(pushSubscription)
      .set({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(and(...filter, isNull(pushSubscription.deleted_at)))
      .returning({
        push_subscription_id: pushSubscription.push_subscription_id,
      });

    return result.length > 0;
  };

  hardDeleteByEndpoint = async (
    endpoint: string,
    provider?: string
  ): Promise<boolean> => {
    const filter = [eq(pushSubscription.endpoint, endpoint)];
    if (provider) {
      filter.push(eq(pushSubscription.provider, provider));
    }

    const result = await this.dbRw
      .delete(pushSubscription)
      .where(and(...filter))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
