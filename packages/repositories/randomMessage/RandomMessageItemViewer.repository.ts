import * as schema from '@core/models';
import { randomMessageItem } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ViewRandomMessageItemResponse } from '@core/schema/randomMessage/viewRandomMessageItem/response.schema';

@injectable()
export class RandomMessageItemViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewRandomMessageItemById = async (
    randomMessageItemId: string,
    randomMessageId: string,
    accountId: string
  ): Promise<ViewRandomMessageItemResponse | null> => {
    const result = await this.dbRo
      .select({
        random_message_item_id: randomMessageItem.random_message_item_id,
        random_message_id: randomMessageItem.random_message_id,
        message: randomMessageItem.message,
        status: randomMessageItem.status,
        type: randomMessageItem.type,
        attachment_url: randomMessageItem.attachment_url,
        mimetype: randomMessageItem.mimetype,
        duration: randomMessageItem.duration,
        width: randomMessageItem.width,
        height: randomMessageItem.height,
        created_at: randomMessageItem.created_at,
        updated_at: randomMessageItem.updated_at,
      })
      .from(randomMessageItem)
      .where(
        and(
          eq(randomMessageItem.random_message_item_id, randomMessageItemId),
          eq(randomMessageItem.random_message_id, randomMessageId),
          eq(randomMessageItem.account_id, accountId)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as ViewRandomMessageItemResponse;
  };
}
