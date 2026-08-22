import * as schema from '@core/models';
import { userCard } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class UserCardDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteUserCard = async (
    userCardId: string,
    userId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(userCard)
      .set({
        deleted_at: date,
        default: false,
        updated_at: date,
      })
      .where(
        and(eq(userCard.user_card_id, userCardId), eq(userCard.user_id, userId))
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
