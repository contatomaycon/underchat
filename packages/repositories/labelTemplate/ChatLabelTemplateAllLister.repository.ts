import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ChatLabelTemplateAllListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listChatLabelTemplateAll = async (
    accountId: string
  ): Promise<ListChatLabelTemplatesResponse[]> => {
    const result = await this.dbRo
      .select({
        label_template_id: labelTemplate.label_template_id,
        label: labelTemplate.label,
        color: labelTemplate.color,
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.account_id, accountId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .orderBy(asc(labelTemplate.label))
      .execute();

    return result as ListChatLabelTemplatesResponse[];
  };
}
