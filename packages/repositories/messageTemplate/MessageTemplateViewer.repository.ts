import * as schema from '@core/models';
import { messageTemplate, messageStatus, account } from '@core/models';
import { ViewMessageTemplateResponse } from '@core/schema/messageTemplate/viewMessageTemplate/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class MessageTemplateViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewMessageTemplateById = async (
    messageTemplateId: string
  ): Promise<ViewMessageTemplateResponse | null> => {
    const result = await this.db
      .select({
        message_template_id: messageTemplate.message_template_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        message_status: {
          message_status_id: messageStatus.message_status_id,
          name: messageStatus.name,
        },
        attachment_url: messageTemplate.attachment_url,
        command: messageTemplate.command,
        message: messageTemplate.message,
        type: messageTemplate.type,
        mimetype: messageTemplate.mimetype,
        duration: messageTemplate.duration,
        width: messageTemplate.width,
        height: messageTemplate.height,
        created_at: messageTemplate.created_at,
      })
      .from(messageTemplate)
      .innerJoin(account, eq(messageTemplate.account_id, account.account_id))
      .innerJoin(
        messageStatus,
        eq(messageTemplate.message_status_id, messageStatus.message_status_id)
      )
      .where(
        and(
          eq(messageTemplate.message_template_id, messageTemplateId),
          isNull(messageTemplate.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    const row = result[0] as ViewMessageTemplateResponse & {
      type?: string | null;
    };

    return {
      ...row,
      type: row.type ?? 'text',
    } as ViewMessageTemplateResponse;
  };
}
