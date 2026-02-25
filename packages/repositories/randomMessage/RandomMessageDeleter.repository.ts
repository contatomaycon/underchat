import * as schema from '@core/models';
import { randomMessage } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class RandomMessageDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteRandomMessageById = async (
    randomMessageId: string,
    accountId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(randomMessage)
      .where(
        and(
          eq(randomMessage.random_message_id, randomMessageId),
          eq(randomMessage.account_id, accountId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
