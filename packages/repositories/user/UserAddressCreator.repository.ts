import { ICreateUserAddress } from '@core/common/interfaces/ICreateUserAddress';
import * as schema from '@core/models';
import { userAddress } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class UserAddressCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createUserAddress = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateUserAddress,
    userId: string
  ): Promise<boolean> => {
    const userAddressId = uuidv4();

    const result = await tx
      .insert(userAddress)
      .values({
        user_address_id: userAddressId,
        user_id: userId,
        country_id: input.country_id,
        zip_code: input.zip_code,
        address1: input.address1,
        address1_partial: input.address1_partial,
        address2: input.address2,
        address2_partial: input.address2_partial,
        city: input.city,
        state: input.state,
        district: input.district,
      })
      .execute();

    return result.rowCount === 1;
  };
}
