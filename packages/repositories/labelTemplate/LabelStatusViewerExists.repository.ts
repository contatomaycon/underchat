import * as schema from '@core/models';
import { labelStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';

@injectable()
export class LabelStatusViewerExistsRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsLabelStatusById = async (labelStatusId: string): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(labelStatus)
      .where(and(eq(labelStatus.label_status_id, labelStatusId)))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
