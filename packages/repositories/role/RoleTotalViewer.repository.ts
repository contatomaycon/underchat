import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { and, count, eq, isNull, notInArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class RoleTotalViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  totalRoleByAccount = async (accountId: string): Promise<number> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          notInArray(permissionRole.permission_role_id, [
            EPermissionRole.master,
            EPermissionRole.administrator,
          ]),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };
}
