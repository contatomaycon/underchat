import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { CreateRoleResponse } from '@core/schema/role/createRole/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class RoleCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createRole = async (
    input: string,
    accountId: string
  ): Promise<CreateRoleResponse | null> => {
    const permissionRoleId = uuidv4();

    const result = await this.db
      .insert(permissionRole)
      .values({
        permission_role_id: permissionRoleId,
        account_id: accountId,
        name: input,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return { permission_role_id: result[0].permission_role_id };
  };
}
