import * as schema from '@core/models';
import { randomMessageItem } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

type UpdateRandomMessageItemInput = {
  random_message_item_id: string;
  random_message_id: string;
  account_id: string;
  message?: string | null;
  status?: string | null;
  type?: string | null;
  attachment_url?: string | null;
  mimetype?: string | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
};

@injectable()
export class RandomMessageItemUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateRandomMessageItemInput
  ): Partial<typeof randomMessageItem.$inferInsert> {
    const inputUpdate: Partial<typeof randomMessageItem.$inferInsert> = {};

    if (input?.message !== undefined && input.message !== null) {
      inputUpdate.message = input.message;
    }

    if (input?.status !== undefined && input.status !== null) {
      inputUpdate.status = input.status;
    }

    if (input?.type !== undefined && input.type !== null) {
      inputUpdate.type = input.type;
    }

    if (input?.attachment_url !== undefined) {
      inputUpdate.attachment_url = input.attachment_url ?? null;
    }

    if (input?.mimetype !== undefined) {
      inputUpdate.mimetype = input.mimetype ?? null;
    }

    if (input?.duration !== undefined) {
      inputUpdate.duration = input.duration ?? null;
    }

    if (input?.width !== undefined) {
      inputUpdate.width = input.width ?? null;
    }

    if (input?.height !== undefined) {
      inputUpdate.height = input.height ?? null;
    }

    return inputUpdate;
  }

  updateRandomMessageItemById = async (
    input: UpdateRandomMessageItemInput
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(randomMessageItem)
      .set(updateInput)
      .where(
        and(
          eq(
            randomMessageItem.random_message_item_id,
            input.random_message_item_id
          ),
          eq(randomMessageItem.random_message_id, input.random_message_id),
          eq(randomMessageItem.account_id, input.account_id)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
