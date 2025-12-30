import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewExpenditureResponse } from '@core/schema/expenditure/viewExpenditure/response.schema';

@injectable()
export class ExpenditureViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewExpenditure = async (
    expenditureId: string
  ): Promise<ViewExpenditureResponse | null> => {
    const result = await this.dbRo.query.expenditure.findMany({
      where: and(
        eq(expenditure.expenditure_id, expenditureId),
        isNull(expenditure.deleted_at)
      ),
      columns: {
        expenditure_id: true,
        name: true,
        description: true,
        price: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!result || result.length === 0) {
      return null;
    }

    return {
      expenditure_id: result[0].expenditure_id,
      name: result[0].name,
      description: result[0].description,
      price: Number(result[0].price),
      created_at: result[0].created_at,
      updated_at: result[0].updated_at,
    };
  };
}
