import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class LabelTemplateViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsLabelTemplateById = async (
    labelTemplateId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(labelTemplate)
      .where(
        and(
          eq(labelTemplate.label_template_id, labelTemplateId),
          isNull(labelTemplate.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
