import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { EPermissionRoleStatus } from '@core/common/enums/EPermissionRoleStatus';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class PermissionRoleAccountViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  getPermissionRoleAccountId = async (
    permissionRoleId: string
  ): Promise<string | null> => {
    const result = await this.dbRo
      .select({
        account_id: permissionRole.account_id,
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.permission_role_id, permissionRoleId),
          eq(permissionRole.status, EPermissionRoleStatus.active),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0].account_id;
  };
}
