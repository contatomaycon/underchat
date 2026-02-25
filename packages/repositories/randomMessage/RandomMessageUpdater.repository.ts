import * as schema from '@core/models';
import { randomMessage } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

type UpdateRandomMessageInput = {
  random_message_id: string;
  account_id: string;
  name?: string | null;
  status?: string | null;
};

@injectable()
export class RandomMessageUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateRandomMessageInput
  ): Partial<typeof randomMessage.$inferInsert> {
    const inputUpdate: Partial<typeof randomMessage.$inferInsert> = {};

    if (input?.name !== undefined && input.name !== null) {
      inputUpdate.name = input.name;
    }

    if (input?.status !== undefined && input.status !== null) {
      inputUpdate.status = input.status;
    }

    return inputUpdate;
  }

  updateRandomMessageById = async (
    input: UpdateRandomMessageInput
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(randomMessage)
      .set(updateInput)
      .where(
        and(
          eq(randomMessage.random_message_id, input.random_message_id),
          eq(randomMessage.account_id, input.account_id)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
