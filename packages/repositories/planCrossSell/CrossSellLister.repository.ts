import * as schema from '@core/models';
import {
  planCrossSell,
  planProduct,
  planProductDescription,
} from '@core/models';
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
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { ListCrossSellResponse } from '@core/schema/planCrossSell/listCrossSell/response.schema';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';

@injectable()
export class CrossSellListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersCrossSell = (
    query: ListCrossSellRequest
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.product_name || query.price) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.product_name
          ? ilike(planProductDescription.name, `%${query.product_name}%`)
          : undefined,
        query.price
          ? ilike(sql`CAST(${planCrossSell.price} AS TEXT)`, `%${query.price}%`)
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

  listCrossSells = async (
    perPage: number,
    currentPage: number,
    query: ListCrossSellRequest
  ): Promise<ListCrossSellResponse[]> => {
    const filtersCrossSell = this.setFiltersCrossSell(query);

    const result = await this.dbRo
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        plan_product_id: planCrossSell.plan_product_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
        created_at: planCrossSell.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProductDescription.name,
          description: planProductDescription.description,
        },
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(
        and(
          ...(filtersCrossSell.length > 0 ? filtersCrossSell : []),
          isNull(planCrossSell.deleted_at)
        )
      )
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result.length) {
      return [] as ListCrossSellResponse[];
    }

    const crossSells: ListCrossSellResponse[] = result.map((item) => ({
      plan_cross_sell_id: item.plan_cross_sell_id,
      plan_product_id: item.plan_product_id,
      quantity: item.quantity,
      price: Number(item.price),
      created_at: item.created_at,
      plan_product: item.plan_product?.plan_product_id
        ? {
            plan_product_id: item.plan_product.plan_product_id,
            name: item.plan_product.name ?? null,
            description: item.plan_product.description ?? null,
          }
        : undefined,
    }));

    return crossSells;
  };

  listCrossSellsTotal = async (
    query: ListCrossSellRequest
  ): Promise<number> => {
    const filtersCrossSell = this.setFiltersCrossSell(query);

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(
        and(
          ...(filtersCrossSell.length > 0 ? filtersCrossSell : []),
          isNull(planCrossSell.deleted_at)
        )
      )
      .execute();

    if (result.length === 0) {
      return 0;
    }

    return result[0].count;
  };

  listAvailableCrossSells = async (): Promise<
    ListAvailableCrossSellResponse[]
  > => {
    const result = await this.dbRo
      .select({
        plan_cross_sell_id: planCrossSell.plan_cross_sell_id,
        plan_product_id: planCrossSell.plan_product_id,
        quantity: planCrossSell.quantity,
        price: planCrossSell.price,
        created_at: planCrossSell.created_at,
        plan_product: {
          plan_product_id: planProduct.plan_product_id,
          name: planProductDescription.name,
          description: planProductDescription.description,
        },
      })
      .from(planCrossSell)
      .innerJoin(
        planProduct,
        eq(planCrossSell.plan_product_id, planProduct.plan_product_id)
      )
      .innerJoin(
        planProductDescription,
        eq(planProduct.plan_product_id, planProductDescription.plan_product_id)
      )
      .where(isNull(planCrossSell.deleted_at))
      .execute();

    if (!result.length) {
      return [] as ListAvailableCrossSellResponse[];
    }

    const crossSells: ListAvailableCrossSellResponse[] = result.map((item) => ({
      plan_cross_sell_id: item.plan_cross_sell_id,
      plan_product_id: item.plan_product_id,
      quantity: item.quantity,
      price: Number(item.price),
      created_at: item.created_at,
      plan_product: item.plan_product?.plan_product_id
        ? {
            plan_product_id: item.plan_product.plan_product_id,
            name: item.plan_product.name ?? null,
            description: item.plan_product.description ?? null,
          }
        : undefined,
    }));

    return crossSells;
  };
}
