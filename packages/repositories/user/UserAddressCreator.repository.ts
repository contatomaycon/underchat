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
import { v7 as uuidv7 } from 'uuid';

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
    const userAddressId = uuidv7();

    const result = await tx
      .insert(userAddress)
      .values({
        user_address_id: userAddressId,
        user_id: userId,
        country_id: input.country_id,
        zip_code: input.zip_code,
        address1: input.address1,
        address1_partial: input.address1_partial,
        address1_c: input.address1_c,
        address2: input.address2,
        address2_partial: input.address2_partial,
        address2_c: input.address2_c,
        city_fiscal_code: input.city_fiscal_code,
        state_fiscal_code: input.state_fiscal_code,
        district: input.district,
      })
      .execute();

    return result.rowCount === 1;
  };
}
