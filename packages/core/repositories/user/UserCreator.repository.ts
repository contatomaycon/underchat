import { EUserStatus } from '@core/common/enums/EUserStatus';
import { ICreateUser } from '@core/common/interfaces/ICreateUser';
import * as schema from '@core/models';
import { user } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class UserCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createUser = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateUser
  ): Promise<string | null> => {
    const userId = uuidv4();

    const result = await tx
      .insert(user)
      .values({
        user_id: userId,
        account_id: input.account_id,
        user_status_id: EUserStatus.active,
        username: input.username,
        email: input.email,
        email_partial: input.email_partial,
        password: input.password,
      })
      .returning();

    if (!result?.length) {
      return null;
    }

    return result[0].user_id;
  };
}
