import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/updateExpenditure/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class ExpenditureUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateExpenditure = async (
    expenditureId: string,
    input: UpdateExpenditureRequest
  ): Promise<boolean> => {
    const updateData: {
      name?: string;
      description?: string | null;
      price?: string;
    } = {};

    if (input.name !== null && input.name !== undefined) {
      updateData.name = input.name;
    }

    if (input.description !== null && input.description !== undefined) {
      updateData.description = input.description;
    }

    if (input.price !== null && input.price !== undefined) {
      updateData.price = input.price.toFixed(2);
    }

    const result = await this.db
      .update(expenditure)
      .set(updateData)
      .where(eq(expenditure.expenditure_id, expenditureId))
      .execute();

    return result.rowCount === 1;
  };
}
