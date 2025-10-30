import { ICreateUserInfo } from '@core/common/interfaces/ICreateUserInfo';
import * as schema from '@core/models';
import { userInfo } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class UserInfoCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createUserInfo = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateUserInfo,
    userId: string
  ): Promise<boolean> => {
    const userInfoId = uuidv4();

    const result = await tx
      .insert(userInfo)
      .values({
        user_info_id: userInfoId,
        user_id: userId,
        phone_ddi: input.phone_ddi,
        phone: input.phone,
        phone_partial: input.phone_partial,
        name: input.name,
        last_name: input.last_name,
        birth_date: input.birth_date,
      })
      .execute();

    return result.rowCount === 1;
  };
}
