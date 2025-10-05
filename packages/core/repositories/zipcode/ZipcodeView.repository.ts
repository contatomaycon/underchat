import * as schema from '@core/models';
import { zipcode } from '@core/models';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { ZipcodeResponseSchema } from '@core/schema/zipcode/viewZipcode/response.schema';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ZipcodeViewRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  async zipcodeView(
    request: ViewZipcodeRequest
  ): Promise<ZipcodeResponseSchema | null> {
    const result = await this.db.query.zipcode.findFirst({
      where: and(
        eq(zipcode.zipcode, request.zipcode),
        eq(zipcode.id_country, request.country_id)
      ),
      with: {
        zcz: {
          columns: {
            city: true,
          },
        },
        zcs: {
          columns: {
            state: true,
          },
        },
        zcd: {
          columns: {
            district: true,
          },
        },
      },
      columns: {
        zipcode: true,
        address_1: true,
        address_2: true,
      },
    });

    if (!result) {
      return null;
    }

    return {
      zipcode: result.zipcode,
      address_1: result.address_1,
      address_2: result.address_2,
      district: result.zcd?.district ?? null,
      city: result.zcz?.city ?? null,
      state: result.zcs?.state ?? null,
    } as ZipcodeResponseSchema;
  }
}
