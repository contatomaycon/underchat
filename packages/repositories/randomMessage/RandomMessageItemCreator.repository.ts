import * as schema from '@core/models';
import { randomMessageItem } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

type CreateRandomMessageItemInput = {
  random_message_id: string;
  account_id: string;
  message: string;
  status: string;
  type: string;
  attachment_url?: string | null;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
};

@injectable()
export class RandomMessageItemCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createRandomMessageItem = async (
    input: CreateRandomMessageItemInput
  ): Promise<string | null> => {
    const randomMessageItemId = uuidv7();

    const result = await this.dbRw
      .insert(randomMessageItem)
      .values({
        random_message_item_id: randomMessageItemId,
        random_message_id: input.random_message_id,
        account_id: input.account_id,
        message: input.message,
        status: input.status,
        type: input.type,
        attachment_url: input.attachment_url,
        mimetype: input.mimetype ?? null,
        duration: input.duration ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
      })
      .execute();

    if (!result) {
      return null;
    }

    return randomMessageItemId;
  };
}
