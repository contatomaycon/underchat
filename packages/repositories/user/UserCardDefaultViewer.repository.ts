import * as schema from '@core/models';
import { userCard } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { IUserCardDefault } from '@core/common/interfaces/IUserCardDefault';

@injectable()
export class UserCardDefaultViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  findDefaultUserCardByUserId = async (
    userId: string
  ): Promise<IUserCardDefault | null> => {
    const result = await this.dbRw
      .select({
        user_card_id: userCard.user_card_id,
        token: userCard.token,
        holder_name: userCard.holder_name,
        last_number: userCard.last_number,
        brand: userCard.brand,
      })
      .from(userCard)
      .where(
        and(
          eq(userCard.user_id, userId),
          eq(userCard.default, true),
          isNull(userCard.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };
}
