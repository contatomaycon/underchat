import * as schema from '@core/models';
import { expenditure } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  isNull,
  SQLWrapper,
  or,
  ilike,
  sql,
} from 'drizzle-orm';
import { ListExpenditureRequest } from '@core/schema/expenditure/listExpenditure/request.schema';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';

@injectable()
export class ExpenditureListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersExpenditure = (
    query: ListExpenditureRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.description || query.price) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(expenditure.name, `%${query.name}%`) : undefined,
        query.description
          ? ilike(expenditure.description, `%${query.description}%`)
          : undefined,
        query.price
          ? ilike(sql`CAST(${expenditure.price} AS TEXT)`, `%${query.price}%`)
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

    if (query.expenditure_id) {
      filters.push(eq(expenditure.expenditure_id, query.expenditure_id));
    }

    return filters;
  };

  listExpenditures = async (
    perPage: number,
    currentPage: number,
    query: ListExpenditureRequest
  ): Promise<ListExpenditureResponse[]> => {
    const filtersExpenditure = this.setFiltersExpenditure(query);

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
      .where(and(...filtersExpenditure, isNull(expenditure.deleted_at)))
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result.length) {
      return [] as ListExpenditureResponse[];
    }

    const expenditures: ListExpenditureResponse[] = result.map((item) => ({
      expenditure_id: item.expenditure_id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    return expenditures;
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

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };
}
