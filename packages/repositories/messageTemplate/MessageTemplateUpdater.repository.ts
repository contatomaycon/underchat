import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/IUpdateMessageTemplate';

@injectable()
export class MessageTemplateUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateMessageTemplate
  ): Partial<typeof messageTemplate.$inferInsert> {
    const inputUpdate: Partial<typeof messageTemplate.$inferInsert> = {};

    if (input?.command) {
      inputUpdate.command = input.command;
    }

    if (input?.message) {
      inputUpdate.message = input.message;
    }

    if (input?.message_status_id) {
      inputUpdate.message_status_id = input.message_status_id;
    }

    if (input?.attachment_url) {
      inputUpdate.attachment_url = input.attachment_url;
    }

    return inputUpdate;
  }

  updateMessageTemplateById = async (
    input: IUpdateMessageTemplate
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(messageTemplate)
      .set(updateInput)
      .where(eq(messageTemplate.message_template_id, input.message_template_id))
      .execute();

    return result.rowCount === 1;
  };
}
