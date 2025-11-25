import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateExpenditureRequest } from '@core/schema/expenditure/editExpenditure/request.schema';

@injectable()
export class ExpenditureUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateExpenditureRequest
  ): Partial<typeof expenditure.$inferInsert> {
    const inputUpdate: Partial<typeof expenditure.$inferInsert> = {};

    if (input.name !== undefined) {
      inputUpdate.name = input.name ?? undefined;
    }

    if (input.description !== undefined) {
      inputUpdate.description = input.description ?? undefined;
    }

    if (input.price !== undefined) {
      inputUpdate.price =
        input.price === null ? undefined : input.price.toString();
    }

    return inputUpdate;
  }

  updateExpenditureById = async (
    input: UpdateExpenditureRequest,
    expenditureId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(expenditure)
      .set(updateInput)
      .where(eq(expenditure.expenditure_id, expenditureId))
      .execute();

    return result.rowCount === 1;
  };
}
