import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateMessageTemplateRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

@injectable()
export class MessageTemplateUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateMessageTemplateRequest
  ): Partial<typeof messageTemplate.$inferInsert> {
    const inputUpdate: Partial<typeof messageTemplate.$inferInsert> = {};

    if (input?.command) {
      inputUpdate.command = input.command;
    }

    if (input?.message) {
      inputUpdate.message = input.message;
    }

    if (input.message_status?.message_status_id) {
      inputUpdate.message_status_id = input.message_status.message_status_id;
    }

    return inputUpdate;
  }

  updateMessageTemplateById = async (
    messageTemplateId: string,
    input: UpdateMessageTemplateRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(messageTemplate)
      .set(updateInput)
      .where(eq(messageTemplate.message_template_id, messageTemplateId))
      .execute();

    return result.rowCount === 1;
  };
}
