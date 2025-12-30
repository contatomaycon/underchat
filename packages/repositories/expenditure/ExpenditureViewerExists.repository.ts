import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, count } from 'drizzle-orm';

@injectable()
export class ExpenditureViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsExpenditureById = async (expenditureId: string): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(expenditure)
      .where(
        and(
          eq(expenditure.expenditure_id, expenditureId),
          isNull(expenditure.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
