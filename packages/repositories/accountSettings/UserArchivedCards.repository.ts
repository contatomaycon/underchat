import * as schema from '@core/models';
import { userCard } from '@core/models';
import { currentTime } from '@core/common/functions/currentTime';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class UserArchivedCardsRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listArchivedUserCards = async (
    userId: string
  ): Promise<ListUserCardResponse[]> => {
    const cards = await this.dbRw
      .select({
        user_card_id: userCard.user_card_id,
        holder_name: userCard.holder_name,
        last_number: userCard.last_number,
        brand: userCard.brand,
        created_at: userCard.created_at,
      })
      .from(userCard)
      .where(and(eq(userCard.user_id, userId), isNotNull(userCard.deleted_at)))
      .orderBy(desc(userCard.deleted_at), desc(userCard.created_at))
      .execute();

    return cards.map((card) => ({
      user_card_id: card.user_card_id,
      holder_name: card.holder_name,
      last_number: card.last_number,
      brand: card.brand,
      created_at: card.created_at,
      // Archived cards cannot be used as the active default card.
      default: false,
    }));
  };

  reactivateUserCard = async (
    userCardId: string,
    userId: string
  ): Promise<ListUserCardResponse | null> => {
    return this.dbRw.transaction(async (tx) => {
      const userCards = await tx
        .select({
          deleted_at: userCard.deleted_at,
        })
        .from(userCard)
        .where(eq(userCard.user_id, userId))
        .for('update')
        .execute();

      const hasActiveCard = userCards.some(
        (userCardRecord) => userCardRecord.deleted_at === null
      );
      const date = currentTime();

      const restoredCards = await tx
        .update(userCard)
        .set({
          deleted_at: null,
          default: !hasActiveCard,
          updated_at: date,
        })
        .where(
          and(
            eq(userCard.user_card_id, userCardId),
            eq(userCard.user_id, userId),
            isNotNull(userCard.deleted_at)
          )
        )
        .returning({
          user_card_id: userCard.user_card_id,
          holder_name: userCard.holder_name,
          last_number: userCard.last_number,
          brand: userCard.brand,
          default: userCard.default,
          created_at: userCard.created_at,
        })
        .execute();

      const restoredCard = restoredCards[0];
      if (!restoredCard) {
        return null;
      }

      return {
        user_card_id: restoredCard.user_card_id,
        holder_name: restoredCard.holder_name,
        last_number: restoredCard.last_number,
        brand: restoredCard.brand,
        default: restoredCard.default,
        created_at: restoredCard.created_at,
      };
    });
  };
}
