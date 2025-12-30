import * as schema from '@core/models';
import { userCard } from '@core/models';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, desc } from 'drizzle-orm';

@injectable()
export class UserCardsListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getUserCardById = async (
    userCardId: string,
    userId: string
  ): Promise<{ user_card_id: string; token: string } | null> => {
    const result = await this.dbRo.query.userCard.findFirst({
      where: and(
        eq(userCard.user_card_id, userCardId),
        eq(userCard.user_id, userId),
        isNull(userCard.deleted_at)
      ),
      columns: {
        user_card_id: true,
        token: true,
      },
    });

    return result || null;
  };

  getUserCardByToken = async (
    userId: string,
    token: string
  ): Promise<{ user_card_id: string; token: string } | null> => {
    const result = await this.dbRo.query.userCard.findFirst({
      where: and(
        eq(userCard.user_id, userId),
        eq(userCard.token, token),
        isNull(userCard.deleted_at)
      ),
      columns: {
        user_card_id: true,
        token: true,
      },
    });

    return result || null;
  };

  getUserCardsCount = async (userId: string): Promise<number> => {
    const result = await this.dbRo
      .select()
      .from(userCard)
      .where(and(eq(userCard.user_id, userId), isNull(userCard.deleted_at)))
      .execute();

    return result.length;
  };

  listUserCards = async (userId: string): Promise<ListUserCardResponse[]> => {
    const result = await this.dbRo
      .select({
        user_card_id: userCard.user_card_id,
        holder_name: userCard.holder_name,
        last_number: userCard.last_number,
        brand: userCard.brand,
        default: userCard.default,
        created_at: userCard.created_at,
      })
      .from(userCard)
      .where(and(eq(userCard.user_id, userId), isNull(userCard.deleted_at)))
      .orderBy(desc(userCard.default), desc(userCard.created_at))
      .execute();

    if (!result.length) {
      return [];
    }

    return result.map((card) => ({
      user_card_id: card.user_card_id,
      holder_name: card.holder_name,
      last_number: card.last_number,
      brand: card.brand,
      default: card.default,
      created_at: card.created_at,
    }));
  };
}
