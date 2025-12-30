import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { ListLabelTemplateAllResponse } from '@core/schema/labelTemplate/listLabelTemplateAll/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class LabelTemplateAllListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listLabelTemplateAll = async (
    accountId: string
  ): Promise<ListLabelTemplateAllResponse[]> => {
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
      .execute();

    return result as ListLabelTemplateAllResponse[];
  };
}
