import * as schema from '@core/models';
import { randomMessageItem } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class RandomMessageItemDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteRandomMessageItemById = async (
    randomMessageItemId: string,
    randomMessageId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(randomMessageItem)
      .where(
        and(
          eq(randomMessageItem.random_message_item_id, randomMessageItemId),
          eq(randomMessageItem.random_message_id, randomMessageId),
          eq(randomMessageItem.account_id, accountId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
