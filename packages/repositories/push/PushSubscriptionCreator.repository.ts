import * as schema from '@core/models';
import { pushSubscription } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, and, isNull, ne, desc, inArray } from 'drizzle-orm';
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
    const now = new Date().toISOString();

    return this.dbRw.transaction(async (tx) => {
      await tx
        .update(pushSubscription)
        .set({
          deleted_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(pushSubscription.provider, input.provider),
            eq(pushSubscription.endpoint, input.endpoint),
            ne(pushSubscription.user_id, input.user_id),
            isNull(pushSubscription.deleted_at)
          )
        )
        .execute();

      const existing = await tx
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
        .orderBy(
          desc(pushSubscription.updated_at),
          desc(pushSubscription.created_at),
          desc(pushSubscription.push_subscription_id)
        )
        .execute();

      if (existing.length > 0 && existing[0].push_subscription_id) {
        const canonicalId = existing[0].push_subscription_id;
        const duplicatedIds = existing
          .slice(1)
          .map((item) => item.push_subscription_id)
          .filter((item): item is string => !!item);

        if (duplicatedIds.length > 0) {
          await tx
            .update(pushSubscription)
            .set({
              deleted_at: now,
              updated_at: now,
            })
            .where(
              and(
                inArray(pushSubscription.push_subscription_id, duplicatedIds),
                isNull(pushSubscription.deleted_at)
              )
            )
            .execute();
        }

        await tx
          .update(pushSubscription)
          .set({
            platform: input.platform,
            p256dh: input.p256dh ?? null,
            auth: input.auth ?? null,
            user_agent: input.user_agent,
            updated_at: now,
            deleted_at: null,
          })
          .where(eq(pushSubscription.push_subscription_id, canonicalId))
          .execute();

        return {
          push_subscription_id: canonicalId,
        };
      }

      const pushSubscriptionId = uuidv7();

      await tx.insert(pushSubscription).values({
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
    });
  };
}
