import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class LabelTemplateDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteLabelTemplateById = async (
    labelTemplateId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await this.db
      .update(labelTemplate)
      .set({
        deleted_at: date,
      })
      .where(eq(labelTemplate.label_template_id, labelTemplateId))
      .execute();

    return result.rowCount === 1;
  };
}
