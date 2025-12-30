import * as schema from '@core/models';
import { permissionAssignment } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class PermissionAssignmentDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deletePermissionAssignmentByUserId = async (
    userId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(permissionAssignment)
      .where(eq(permissionAssignment.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };

  deletePermissionAssignmentByUserIdTx = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(permissionAssignment)
      .where(eq(permissionAssignment.user_id, userId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
