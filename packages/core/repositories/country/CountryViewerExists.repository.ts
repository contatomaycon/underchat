import * as schema from '@core/models';
import { country } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { count, eq } from 'drizzle-orm';

@injectable()
export class CountryViewerExistsRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  existsCountryById = async (countryId: number): Promise<boolean> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(country)
      .where(eq(country.country_id, countryId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
