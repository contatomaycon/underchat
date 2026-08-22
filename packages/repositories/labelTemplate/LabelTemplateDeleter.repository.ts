import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class LabelTemplateDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteLabelTemplateById = async (
    labelTemplateId: string,
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(labelTemplate)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(labelTemplate.label_template_id, labelTemplateId),
          eq(labelTemplate.account_id, accountId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
