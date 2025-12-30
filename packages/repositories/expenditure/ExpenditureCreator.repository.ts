import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { CreateExpenditureRequest } from '@core/schema/expenditure/createExpenditure/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ExpenditureCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createExpenditure = async (
    input: CreateExpenditureRequest
  ): Promise<string | null> => {
    const expenditureId = uuidv7();

    const result = await this.db
      .insert(expenditure)
      .values({
        expenditure_id: expenditureId,
        name: input.name,
        description: input.description,
        price: input.price.toString(),
      })
      .execute();

    if (!result) {
      return null;
    }

    return expenditureId;
  };
}
