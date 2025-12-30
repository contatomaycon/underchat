import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, isNull, SQLWrapper, or, ilike, sql } from 'drizzle-orm';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';

@injectable()
export class ExpenditureListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersExpenditure = (
    query: ListExpenditureRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.description || query.price !== undefined) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(expenditure.name, `%${query.name}%`) : undefined,
        query.description
          ? ilike(expenditure.description, `%${query.description}%`)
          : undefined,
        query.price !== undefined && query.price !== null
          ? ilike(
              sql`CAST(${expenditure.price} AS TEXT)`,
              `%${query.price.toString()}%`
            )
          : undefined,
      ];

      const filteredConditions = conditions.filter(
        (condition): condition is SQLWrapper => condition !== undefined
      );

      if (filteredConditions.length > 0) {
        const combined = or(...filteredConditions);
        if (combined) filters.push(combined);
      }
    }

    return filters;
  };

  listExpenditures = async (
    perPage: number,
    currentPage: number,
    query: ListExpenditureRequest
  ): Promise<ListExpenditureResponse[]> => {
    const filtersExpenditure = this.setFiltersExpenditure(query);

    const result = await this.db.query.expenditure.findMany({
      where: and(isNull(expenditure.deleted_at), ...filtersExpenditure),
      columns: {
        expenditure_id: true,
        name: true,
        description: true,
        price: true,
        created_at: true,
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    return result.map((item) => ({
      expenditure_id: item.expenditure_id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      created_at: item.created_at,
    }));
  };

  listExpendituresTotal = async (
    query: ListExpenditureRequest
  ): Promise<number> => {
    const filtersExpenditure = this.setFiltersExpenditure(query);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(expenditure)
      .where(and(...filtersExpenditure, isNull(expenditure.deleted_at)))
      .execute();

    return result[0]?.count ?? 0;
  };
}
