import * as schema from '@core/models';
import { sector, sectorStatus, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNull,
  SQL,
  SQLWrapper,
  or,
  ilike,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';
import { ListSectorResponse } from '@core/schema/sector/listSector/response.schema';
import { ESortBySector } from '@core/common/enums/ESortBySector';

@injectable()
export class SectorListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListSectorRequest): SQL[] => {
    const orders: SQL[] = [];

    if (query.sort_by?.length) {
      query.sort_by.forEach(({ key, order }) => {
        if (key === ESortBySector.name)
          orders.push(
            order === ESortOrder.asc ? asc(sector.name) : desc(sector.name)
          );
      });
    }

    if (!query.sort_by?.length) {
      orders.push(asc(sector.created_at), desc(sector.sector_id));
    }

    return orders;
  };

  private readonly setFilters = (query: ListSectorRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.name || query.account || query.sector_status || query.color) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.name ? ilike(sector.name, `%${query.name}%`) : undefined,
        query.account ? ilike(account.name, `%${query.account}%`) : undefined,
        query.color ? ilike(sector.color, `%${query.color}%`) : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    if (query.sector_status) {
      filters.push(eq(sectorStatus.sector_status_id, query.sector_status));
    }

    return filters;
  };

  listSector = async (
    perPage: number,
    currentPage: number,
    query: ListSectorRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListSectorResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const queryBuilder = this.db
      .select({
        sector_id: sector.sector_id,
        name: sector.name,
        account: {
          id: account.account_id,
          name: account.name,
        },
        sector_status: {
          id: sectorStatus.sector_status_id,
          name: sectorStatus.name,
        },
        color: sector.color,
        created_at: sector.created_at,
      })
      .from(sector)
      .leftJoin(account, eq(sector.account_id, account.account_id))
      .leftJoin(
        sectorStatus,
        eq(sector.sector_status_id, sectorStatus.sector_status_id)
      )
      .where(and(accountCondition, isNull(sector.deleted_at), ...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListSectorResponse[];
    }

    return result.map((sector) => ({
      sector_id: sector.sector_id,
      name: sector.name,
      color: sector.color,
      sector_status: isAdministrator ? sector.sector_status : undefined,
      account: isAdministrator ? sector.account : undefined,
      created_at: sector.created_at,
    })) as ListSectorResponse[];
  };

  listSectorTotal = async (
    query: ListSectorRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(sector.account_id, accountId);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(sector)
      .leftJoin(account, eq(sector.account_id, account.account_id))
      .leftJoin(
        sectorStatus,
        eq(sector.sector_status_id, sectorStatus.sector_status_id)
      )
      .where(and(accountCondition, isNull(sector.deleted_at), ...filters))
      .execute();

    return result[0]?.count ?? 0;
  };
}
