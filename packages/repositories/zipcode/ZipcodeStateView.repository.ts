import * as schema from '@core/models';
import { zipcodeState } from '@core/models';
import { ListStatesRequest } from '@core/schema/zipcode/listStates/request.schema';
import { StateListResponse } from '@core/schema/zipcode/listStates/response.schema';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ZipcodeStateViewRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  async listStates(request: ListStatesRequest): Promise<StateListResponse> {
    const selectQuery = this.db
      .select({
        id_zipcode_state: zipcodeState.id_zipcode_state,
        state: zipcodeState.state,
        abbreviation: zipcodeState.abbreviation,
        fiscal_code: zipcodeState.fiscal_code,
      })
      .from(zipcodeState);

    const results = request.country_id
      ? await selectQuery
          .where(eq(zipcodeState.id_country, request.country_id))
          .orderBy(zipcodeState.state)
          .execute()
      : await selectQuery.orderBy(zipcodeState.state).execute();

    return results;
  }
}
