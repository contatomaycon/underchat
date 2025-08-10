import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';

@injectable()
export class PermissionRoleAccountListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listPermissionRoleAccountById = async (
    accountId: string
  ): Promise<ListRoleAccountResponse[] | null> => {
    const result = await this.db
      .select({
        id: permissionRole.permission_role_id,
        name: permissionRole.name,
      })
      .from(permissionRole)
      .where(eq(permissionRole.account_id, accountId))
      .execute();

    if (!result?.length) {
      return null;
    }

    return result as ListRoleAccountResponse[];
  };
}
