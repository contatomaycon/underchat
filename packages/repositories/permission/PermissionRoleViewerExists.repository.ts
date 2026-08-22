import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, isNull } from 'drizzle-orm';

@injectable()
export class PermissionRoleViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsPermissionRoleById = async (
    accountId: string,
    permissionRoleId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          eq(permissionRole.permission_role_id, permissionRoleId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
