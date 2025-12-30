import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { CreateRoleResponse } from '@core/schema/role/createRole/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

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

    const result = await this.dbRw
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

    return { permission_role_id: result[0].permission_role_id };
  };
}
