import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class MessageTemplateCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createMessageTemplate = async (
    input: CreateMessageTemplateRequest,
    accountId: string
  ): Promise<string | null> => {
    const messageTemplateId = uuidv4();

    const result = await this.db
      .insert(messageTemplate)
      .values({
        message_template_id: messageTemplateId,
        account_id: accountId,
        message_status_id: input.message_status.message_status_id,
        command: input.command,
        message: input.message,
      })
      .execute();

    if (!result) {
      return null;
    }

    return messageTemplateId;
  };
}
