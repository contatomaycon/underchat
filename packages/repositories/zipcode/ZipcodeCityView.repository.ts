import * as schema from '@core/models';
import { zipcodeCity } from '@core/models';
import { ListCitiesRequest } from '@core/schema/zipcode/listCities/request.schema';
import { CityListResponse } from '@core/schema/zipcode/listCities/response.schema';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ZipcodeCityViewRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async listCities(request: ListCitiesRequest): Promise<CityListResponse> {
    const results = await this.dbRo
      .select({
        id_zipcode_city: zipcodeCity.id_zipcode_city,
        city: zipcodeCity.city,
        fiscal_code: zipcodeCity.fiscal_code,
      })
      .from(zipcodeCity)
      .where(eq(zipcodeCity.id_zipcode_state, request.id_zipcode_state))
      .orderBy(zipcodeCity.city)
      .execute();

    return results;
  }
}
