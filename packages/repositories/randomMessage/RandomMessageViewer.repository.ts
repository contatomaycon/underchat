import * as schema from '@core/models';
import { randomMessage } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ViewRandomMessageResponse } from '@core/schema/randomMessage/viewRandomMessage/response.schema';

@injectable()
export class RandomMessageViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewRandomMessageById = async (
    randomMessageId: string,
    accountId: string
  ): Promise<ViewRandomMessageResponse | null> => {
    const result = await this.dbRo
      .select({
        random_message_id: randomMessage.random_message_id,
        name: randomMessage.name,
        status: randomMessage.status,
        created_at: randomMessage.created_at,
        updated_at: randomMessage.updated_at,
      })
      .from(randomMessage)
      .where(
        and(
          eq(randomMessage.random_message_id, randomMessageId),
          eq(randomMessage.account_id, accountId)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as ViewRandomMessageResponse;
  };
}
