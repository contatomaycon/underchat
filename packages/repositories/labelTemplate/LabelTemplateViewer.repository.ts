import * as schema from '@core/models';
import { labelTemplate, labelStatus, account } from '@core/models';
import { ViewLabelTemplateResponse } from '@core/schema/labelTemplate/viewLabelTemplate/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class LabelTemplateViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewLabelTemplateById = async (
    labelTemplateId: string,
    accountId?: string
  ): Promise<ViewLabelTemplateResponse | null> => {
    const conditions = [
      eq(labelTemplate.label_template_id, labelTemplateId),
      isNull(labelTemplate.deleted_at),
    ];

    if (accountId) {
      conditions.push(eq(labelTemplate.account_id, accountId));
    }

    const result = await this.dbRo
      .select({
        label_template_id: labelTemplate.label_template_id,
        account: {
          account_id: account.account_id,
          name: account.name,
        },
        label_status: {
          label_status_id: labelStatus.label_status_id,
          name: labelStatus.name,
        },
        label: labelTemplate.label,
        color: labelTemplate.color,
        created_at: labelTemplate.created_at,
      })
      .from(labelTemplate)
      .innerJoin(account, eq(labelTemplate.account_id, account.account_id))
      .innerJoin(
        labelStatus,
        eq(labelTemplate.label_status_id, labelStatus.label_status_id)
      )
      .where(and(...conditions))
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0] as ViewLabelTemplateResponse;
  };
}
