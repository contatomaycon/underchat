import * as schema from '@core/models';
import { userCard } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, asc } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class UserCardDefaultUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  updateUserCardDefault = async (
    userCardId: string,
    userId: string
  ): Promise<boolean> => {
    const date = currentTime();

    await this.dbRw.transaction(async (tx) => {
      await tx
        .update(userCard)
        .set({
          default: false,
          updated_at: date,
        })
        .where(and(eq(userCard.user_id, userId), isNull(userCard.deleted_at)))
        .execute();

      await tx
        .update(userCard)
        .set({
          default: true,
          updated_at: date,
        })
        .where(
          and(
            eq(userCard.user_card_id, userCardId),
            eq(userCard.user_id, userId)
          )
        )
        .execute();
    });

    return true;
  };

  setFirstCardAsDefault = async (userId: string): Promise<boolean> => {
    const firstCard = await this.dbRw
      .select({
        user_card_id: userCard.user_card_id,
      })
      .from(userCard)
      .where(and(eq(userCard.user_id, userId), isNull(userCard.deleted_at)))
      .orderBy(asc(userCard.created_at))
      .limit(1)
      .execute();

    if (!firstCard || firstCard.length === 0) {
      return false;
    }

    const date = currentTime();

    await this.dbRw
      .update(userCard)
      .set({
        default: true,
        updated_at: date,
      })
      .where(
        and(
          eq(userCard.user_card_id, firstCard[0].user_card_id),
          eq(userCard.user_id, userId)
        )
      )
      .execute();

    return true;
  };
}
