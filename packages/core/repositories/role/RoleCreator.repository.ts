import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { CreateRoleResponse } from '@core/schema/role/createServer/response.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class RoleCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createRole = async (
    input: string,
    accountId: number
  ): Promise<CreateRoleResponse | null> => {
    const result = await this.db
      .insert(permissionRole)
      .values({
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
