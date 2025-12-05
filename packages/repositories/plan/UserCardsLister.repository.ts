import * as schema from '@core/models';
import { userCard } from '@core/models';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class UserCardsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listUserCards = async (userId: string): Promise<ListUserCardResponse[]> => {
    const result = await this.db
      .select({
        user_card_id: userCard.user_card_id,
        holder_name: userCard.holder_name,
        last_number: userCard.last_number,
        brand: userCard.brand,
        default: userCard.default,
        created_at: userCard.created_at,
      })
      .from(userCard)
      .where(eq(userCard.user_id, userId))
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
