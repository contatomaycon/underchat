import * as schema from '@core/models';
import { pushSubscription } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { IPushSubscription } from '@core/common/interfaces/IPushSubscription';

@injectable()
export class PushSubscriptionCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createOrUpdate = async (
    input: IPushSubscription
  ): Promise<{ push_subscription_id: string }> => {
    const existing = await this.dbRw
      .select({
        push_subscription_id: pushSubscription.push_subscription_id,
      })
      .from(pushSubscription)
      .where(
        and(
          eq(pushSubscription.user_id, input.user_id),
          eq(pushSubscription.provider, input.provider),
          eq(pushSubscription.endpoint, input.endpoint),
          isNull(pushSubscription.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (existing.length > 0 && existing[0].push_subscription_id) {
      await this.dbRw
        .update(pushSubscription)
        .set({
          platform: input.platform,
          p256dh: input.p256dh ?? null,
          auth: input.auth ?? null,
          user_agent: input.user_agent,
          updated_at: new Date().toISOString(),
          deleted_at: null,
        })
        .where(
          eq(
            pushSubscription.push_subscription_id,
            existing[0].push_subscription_id
          )
        );

      return {
        push_subscription_id: existing[0].push_subscription_id,
      };
    }

    const pushSubscriptionId = uuidv7();

    await this.dbRw.insert(pushSubscription).values({
      push_subscription_id: pushSubscriptionId,
      user_id: input.user_id,
      provider: input.provider,
      platform: input.platform,
      endpoint: input.endpoint,
      p256dh: input.p256dh ?? null,
      auth: input.auth ?? null,
      user_agent: input.user_agent,
    });

    return {
      push_subscription_id: pushSubscriptionId,
    };
  };
}
