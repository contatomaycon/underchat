import * as schema from '@core/models';
import {
  permissionAction,
  permissionRole,
  permissionRoleAction,
} from '@core/models';
import { CreateRoleResponse } from '@core/schema/role/createRole/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { eq } from 'drizzle-orm';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';

@injectable()
export class RoleCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createRole = async (
    input: string,
    accountId: string,
    description: string | null | undefined
  ): Promise<CreateRoleResponse | null> => {
    const permissionRoleId = uuidv7();

    return this.dbRw.transaction(async (tx) => {
      const result = await tx
        .insert(permissionRole)
        .values({
          permission_role_id: permissionRoleId,
          account_id: accountId,
          name: input,
          description: description ?? null,
        })
        .returning();

      if (!result?.length) {
        return null;
      }

      const [transferPermission] = await tx
        .select({ permission_action_id: permissionAction.permission_action_id })
        .from(permissionAction)
        .where(
          eq(
            permissionAction.action,
            EWorkerPermissions.view_all_channels_for_transfer_and_forwarding
          )
        )
        .limit(1);

      if (transferPermission) {
        await tx.insert(permissionRoleAction).values({
          permission_role_action_id: uuidv7(),
          permission_action_id: transferPermission.permission_action_id,
          permission_role_id: result[0].permission_role_id,
        });
      }

      return { permission_role_id: result[0].permission_role_id };
    });
  };
}
