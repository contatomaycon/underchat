import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';

@injectable()
export class ExpenditureViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewExpenditureById = async (
    expenditureId: string
  ): Promise<ListExpenditureResponse | null> => {
    const result = await this.db
      .select({
        expenditure_id: expenditure.expenditure_id,
        name: expenditure.name,
        description: expenditure.description,
        price: expenditure.price,
        created_at: expenditure.created_at,
        updated_at: expenditure.updated_at,
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
      return null;
    }

    const item = result[0];

    return {
      expenditure_id: item.expenditure_id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
  };
}
