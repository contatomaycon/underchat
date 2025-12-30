import * as schema from '@core/models';
import { messageTemplate, messageStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, asc, eq, ilike, isNull, SQLWrapper } from 'drizzle-orm';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';

@injectable()
export class ChatQuickMessageTemplatesListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listQuickMessageTemplates = async (
    query: ListQuickMessageTemplatesRequest,
    accountId: string
  ): Promise<ListQuickMessageTemplatesResponse[]> => {
    const filters: SQLWrapper[] = [
      eq(messageTemplate.account_id, accountId),
      eq(messageStatus.message_status_id, EMessageStatus.active),
      isNull(messageTemplate.deleted_at),
    ];

    if (query.command) {
      filters.push(ilike(messageTemplate.command, `${query.command}%`));
    }

    const result = await this.db
      .select({
        message_template_id: messageTemplate.message_template_id,
        command: messageTemplate.command,
        message: messageTemplate.message,
        attachment_url: messageTemplate.attachment_url,
        type: messageTemplate.type,
        mimetype: messageTemplate.mimetype,
        duration: messageTemplate.duration,
        width: messageTemplate.width,
        height: messageTemplate.height,
      })
      .from(messageTemplate)
      .innerJoin(
        messageStatus,
        eq(messageTemplate.message_status_id, messageStatus.message_status_id)
      )
      .where(and(...filters))
      .orderBy(asc(messageTemplate.command))
      .limit(20)
      .execute();

    if (!result?.length) {
      return [] as ListQuickMessageTemplatesResponse[];
    }

    return result.map((message) => ({
      message_template_id: message.message_template_id,
      command: message.command,
      message: message.message,
      attachment_url: message.attachment_url ?? null,
      type: message.type,
      mimetype: message.mimetype ?? null,
      duration: message.duration ?? null,
      width: message.width ?? null,
      height: message.height ?? null,
    })) as ListQuickMessageTemplatesResponse[];
  };
}
