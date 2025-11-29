import * as schema from '@core/models';
import { labelTemplate, labelStatus } from '@core/models';
import { ChatboxChatTagResponse } from '@core/schema/chatbox/listChatTags/response.schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';

@injectable()
export class ChatboxChatTagsListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listChatboxChatTags = async (
    accountId: string
  ): Promise<ChatboxChatTagResponse[]> => {
    const result = await this.db
      .select({
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(labelTemplate)
      .leftJoin(
        labelStatus,
        eq(labelTemplate.label_status_id, labelStatus.label_status_id)
      )
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          eq(labelStatus.label_status_id, ELabelStatus.active),
          isNull(labelTemplate.deleted_at)
        )
      )
      .orderBy(asc(labelTemplate.label))
      .execute();

    if (!result || result.length === 0) {
      return [];
    }

    return result.map((tag) => ({
      label_template_id: tag.label_template_id,
      label: tag.label,
      color: tag.color,
    }));
  };
}
