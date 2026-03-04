import * as schema from '@core/models';
import { pushSubscription } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull } from 'drizzle-orm';

@injectable()
export class PushSubscriptionListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listByUserId = async (userId: string) => {
    return this.dbRo
      .select({
        push_subscription_id: pushSubscription.push_subscription_id,
        user_id: pushSubscription.user_id,
        provider: pushSubscription.provider,
        platform: pushSubscription.platform,
        endpoint: pushSubscription.endpoint,
        p256dh: pushSubscription.p256dh,
        auth: pushSubscription.auth,
      })
      .from(pushSubscription)
      .where(
        and(
          eq(pushSubscription.user_id, userId),
          isNull(pushSubscription.deleted_at)
        )
      )
      .execute();
  };
}
