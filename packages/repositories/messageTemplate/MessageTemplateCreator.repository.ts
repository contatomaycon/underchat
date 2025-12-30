import { ICreateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/ICreateMessageTemplate';
import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class MessageTemplateCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createMessageTemplate = async (
    input: ICreateMessageTemplate
  ): Promise<string | null> => {
    const messageTemplateId = uuidv7();

    const result = await this.db
      .insert(messageTemplate)
      .values({
        message_template_id: messageTemplateId,
        account_id: input.account_id,
        message_status_id: input.message_status_id,
        command: input.command,
        message: input.message,
        attachment_url: input.attachment_url,
        type: input.type,
        mimetype: input.mimetype ?? null,
        duration: input.duration ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
      })
      .execute();

    if (!result) {
      return null;
    }

    return messageTemplateId;
  };
}
