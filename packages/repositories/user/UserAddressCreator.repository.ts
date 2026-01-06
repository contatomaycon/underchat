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
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
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
        zip_code: input.zip_code ?? null,
        address1: input.address1 ?? null,
        address1_partial: input.address1_partial ?? null,
        address1_c: input.address1_c ?? null,
        address2: input.address2 ?? null,
        address2_partial: input.address2_partial ?? null,
        address2_c: input.address2_c ?? null,
        city_fiscal_code: input.city_fiscal_code ?? null,
        state_fiscal_code: input.state_fiscal_code ?? null,
        district: input.district ?? null,
      })
      .execute();

    return result.rowCount === 1;
  };
}
