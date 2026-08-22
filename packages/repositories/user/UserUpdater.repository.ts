import * as schema from '@core/models';
import { user } from '@core/models';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, sql } from 'drizzle-orm';
import { IUpdateUser } from '@core/common/interfaces/IUpdateUser';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class UserUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(input: IUpdateUser): Partial<typeof user.$inferInsert> {
    const inputUpdate: Partial<typeof user.$inferInsert> = {};

    if (input.user_status_id) {
      inputUpdate.user_status_id = input.user_status_id;
    }

    if (input.email) {
      inputUpdate.email = input.email;
    }

    if (input.email_partial) {
      inputUpdate.email_partial = input.email_partial;
    }

    if (input.email_c) {
      inputUpdate.email_c = input.email_c;
    }

    if (input.password) {
      inputUpdate.password = input.password;
    }

    if (input.account_id) {
      inputUpdate.account_id = input.account_id;
    }

    return inputUpdate;
  }

  updateUserById = async (
    userId: string,
    input: IUpdateUser,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const whereCondition = and(
      eq(user.user_id, userId),
      eq(user.account_id, accountId),
      input.user_status_id === EUserStatus.blocked
        ? sql`NOT EXISTS (
            SELECT 1
            FROM "permission_assignment" pa
            WHERE pa.user_id = ${user.user_id}
              AND pa.permission_role_id IN (
                ${EPermissionRole.master},
                ${EPermissionRole.administrator}
              )
          )`
        : undefined
    );

    const result = await this.dbRw
      .update(user)
      .set(updateInput)
      .where(whereCondition)
      .execute();

    return result.rowCount === 1;
  };

  updateUserByIdTx = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    userId: string,
    input: IUpdateUser,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const whereCondition = and(
      eq(user.user_id, userId),
      eq(user.account_id, accountId),
      input.user_status_id === EUserStatus.blocked
        ? sql`NOT EXISTS (
            SELECT 1
            FROM "permission_assignment" pa
            WHERE pa.user_id = ${user.user_id}
              AND pa.permission_role_id IN (
                ${EPermissionRole.master},
                ${EPermissionRole.administrator}
              )
          )`
        : undefined
    );

    const result = await tx
      .update(user)
      .set(updateInput)
      .where(whereCondition)
      .execute();

    return result.rowCount === 1;
  };
}
