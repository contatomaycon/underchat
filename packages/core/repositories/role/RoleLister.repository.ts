import * as schema from '@core/models';
import { permissionRole } from '@core/models';
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
  like,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListRoleResponse } from '@core/schema/role/listRole/response.schema';
import { ListRoleRequest } from '@core/schema/role/listRole/request.schema';
import { ESortByRole } from '@core/common/enums/ESortByRole';

@injectable()
export class RoleListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListRoleRequest): SQL[] => {
    const orders: SQL[] = [];

    if (query.sort_by?.length) {
      query.sort_by.forEach(({ key, order }) => {
        if (key === ESortByRole.name)
          orders.push(
            order === ESortOrder.asc
              ? asc(permissionRole.name)
              : desc(permissionRole.name)
          );
      });
    }

    if (!query.sort_by?.length) {
      orders.push(
        asc(permissionRole.created_at),
        desc(permissionRole.permission_role_id)
      );
    }

    return orders;
  };

  private readonly setFilters = (query: ListRoleRequest): SQLWrapper[] => {
    const condition = and(
      query.role_name
        ? like(permissionRole.name, `%${query.role_name}%`)
        : undefined
    );

    return condition ? [condition] : [];
  };

  listRoles = async (
    perPage: number,
    currentPage: number,
    query: ListRoleRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListRoleResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);

    const queryBuilder = this.db
      .select({
        permission_role_id: permissionRole.permission_role_id,
        name: permissionRole.name,
        account_id: permissionRole.account_id,
        created_at: permissionRole.created_at,
      })
      .from(permissionRole)
      .where(
        and(accountCondition, isNull(permissionRole.deleted_at), ...filters)
      );

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    if (!result?.length) {
      return [] as ListRoleResponse[];
    }

    return result.map((role) => ({
      permission_role_id: role.permission_role_id,
      name: role.name,
      account_id: isAdministrator ? role.account_id : undefined,
      created_at: role.created_at,
    })) as ListRoleResponse[];
  };

  listRolesTotal = async (
    query: ListRoleRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(permissionRole)
      .where(
        and(accountCondition, isNull(permissionRole.deleted_at), ...filters)
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
