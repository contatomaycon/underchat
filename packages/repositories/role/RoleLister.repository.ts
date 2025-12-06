import * as schema from '@core/models';
import { permissionRole, account } from '@core/models';
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
  ne,
} from 'drizzle-orm';
import { ESortOrder } from '@core/common/enums/ESortOrder';
import { ListRoleResponse } from '@core/schema/role/listRole/response.schema';
import { ListRoleRequest } from '@core/schema/role/listRole/request.schema';
import { ESortByRole } from '@core/common/enums/ESortByRole';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';

@injectable()
export class RoleListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setOrders = (query: ListRoleRequest): SQL[] => {
    const orders: SQL[] = [];
    const sort = query.sort_by;

    if (!sort?.length) {
      orders.push(
        asc(permissionRole.created_at),
        desc(permissionRole.permission_role_id)
      );

      return orders;
    }

    for (const { key, order } of sort) {
      if (key !== ESortByRole.name) continue;
      orders.push(
        order === ESortOrder.asc
          ? asc(permissionRole.name)
          : desc(permissionRole.name)
      );
    }

    return orders;
  };

  private readonly setFilters = (query: ListRoleRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (query.role_name || query.account) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.role_name
          ? ilike(permissionRole.name, `%${query.role_name}%`)
          : undefined,
        query.account ? ilike(account.name, `%${query.account}%`) : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    return filters;
  };

  listRoles = async (
    perPage: number,
    currentPage: number,
    query: ListRoleRequest,
    accountId: string,
    isAdministrator: boolean,
    currentUserPermissionRoleId: string
  ): Promise<ListRoleResponse[]> => {
    const filters = this.setFilters(query);
    const orders = this.setOrders(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);
    const excludeOwnRole = ne(
      permissionRole.permission_role_id,
      currentUserPermissionRoleId
    );
    const excludeAdministratorRole = ne(
      permissionRole.permission_role_id,
      '019a930d-c6f5-75af-82a5-899cb84b6089'
    );
    const excludeMasterRole = isAdministrator
      ? undefined
      : ne(permissionRole.permission_role_id, EPermissionRole.master);

    const queryBuilder = this.db
      .select({
        permission_role_id: permissionRole.permission_role_id,
        name: permissionRole.name,
        description: permissionRole.description,
        account: {
          id: account.account_id,
          name: account.name,
        },
        created_at: permissionRole.created_at,
      })
      .from(permissionRole)
      .leftJoin(account, eq(permissionRole.account_id, account.account_id))
      .where(
        and(
          accountCondition,
          isNull(permissionRole.deleted_at),
          excludeOwnRole,
          excludeAdministratorRole,
          excludeMasterRole,
          ...filters
        )
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
      description: role.description,
      account: isAdministrator ? role.account : undefined,
      created_at: role.created_at,
    })) as ListRoleResponse[];
  };

  listRolesTotal = async (
    query: ListRoleRequest,
    accountId: string,
    isAdministrator: boolean,
    currentUserPermissionRoleId: string
  ): Promise<number> => {
    const filters = this.setFilters(query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(permissionRole.account_id, accountId);
    const excludeOwnRole = ne(
      permissionRole.permission_role_id,
      currentUserPermissionRoleId
    );
    const excludeAdministratorRole = ne(
      permissionRole.permission_role_id,
      '019a930d-c6f5-75af-82a5-899cb84b6089'
    );
    const excludeMasterRole = isAdministrator
      ? undefined
      : ne(permissionRole.permission_role_id, EPermissionRole.master);

    const result = await this.db
      .select({
        count: count(),
      })
      .from(permissionRole)
      .leftJoin(account, eq(permissionRole.account_id, account.account_id))
      .where(
        and(
          accountCondition,
          isNull(permissionRole.deleted_at),
          excludeOwnRole,
          excludeAdministratorRole,
          excludeMasterRole,
          ...filters
        )
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
