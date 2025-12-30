import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class PermissionAssignmentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createPermissionAssignment = async (
    userId: string,
    permissionRoleId: string
  ): Promise<string | null> => {
    const permissionAssignmentId = uuidv7();

    const result = await this.db
      .insert(permissionAssignment)
      .values({
        permission_assignment_id: permissionAssignmentId,
        permission_role_id: permissionRoleId,
        user_id: userId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return permissionAssignmentId;
  };

  createPermissionAssignmentInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    permissionRoleId: string,
    accountId: string
  ): Promise<string | null> => {
    const permissionAssignmentId = uuidv7();

    const result = await tx
      .insert(permissionAssignment)
      .values({
        permission_assignment_id: permissionAssignmentId,
        permission_role_id: permissionRoleId,
        user_id: userId,
        account_id: accountId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return permissionAssignmentId;
  };
}
