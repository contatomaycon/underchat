import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';

@injectable()
export class ExpenditureDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteExpenditureById = async (expenditureId: string): Promise<boolean> => {
    const date = currentTime();

    const result = await this.dbRw
      .update(expenditure)
      .set({
        deleted_at: date,
      })
      .where(eq(expenditure.expenditure_id, expenditureId))
      .execute();

    return result.rowCount === 1;
  };
}
