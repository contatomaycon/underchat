import * as schema from '@core/models';
import { randomMessage } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

type CreateRandomMessageInput = {
  account_id: string;
  name: string;
  status: string;
};

@injectable()
export class RandomMessageCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createRandomMessage = async (
    input: CreateRandomMessageInput
  ): Promise<string | null> => {
    const randomMessageId = uuidv7();

    const result = await this.dbRw
      .insert(randomMessage)
      .values({
        random_message_id: randomMessageId,
        account_id: input.account_id,
        name: input.name,
        status: input.status,
      })
      .execute();

    if (!result) {
      return null;
    }

    return randomMessageId;
  };
}
