import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class MessageTemplateDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteMessageTemplateById = async (
    messageTemplateId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(messageTemplate)
      .set({
        deleted_at: date,
      })
      .where(eq(messageTemplate.message_template_id, messageTemplateId))
      .execute();

    return result.rowCount === 1;
  };
}
