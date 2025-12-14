import * as schema from '@core/models';
import { user, permissionAssignment, account } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';

@injectable()
export class UserMasterViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findMasterUserByAccountId = async (
    accountId: string
  ): Promise<{
    user_id: string;
    email: string;
    account_id: string;
    account_name: string | null;
  } | null> => {
    const result = await this.db
      .select({
        user_id: user.user_id,
        email: user.email,
        account_id: user.account_id,
        account_name: account.name,
      })
      .from(user)
      .innerJoin(
        permissionAssignment,
        eq(permissionAssignment.user_id, user.user_id)
      )
      .innerJoin(account, eq(account.account_id, user.account_id))
      .where(
        and(
          eq(user.account_id, accountId),
          inArray(permissionAssignment.permission_role_id, [
            EPermissionRole.master,
            EPermissionRole.administrator,
          ]),
          isNull(user.deleted_at),
          isNull(account.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return {
      user_id: result[0].user_id,
      email: result[0].email,
      account_id: result[0].account_id,
      account_name: result[0].account_name,
    };
  };
}
