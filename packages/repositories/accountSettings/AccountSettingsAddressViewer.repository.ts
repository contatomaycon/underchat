import * as schema from '@core/models';
import { userAddress } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class AccountSettingsAddressViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewAddressByUserId = async (userId: string) => {
    const result = await this.db.query.userAddress.findFirst({
      where: and(
        eq(userAddress.user_id, userId),
        isNull(userAddress.deleted_at)
      ),
      with: {
        uuc: {
          columns: {
            country_id: true,
          },
        },
        uzc: {
          columns: {
            id_zipcode_city: true,
            city: true,
          },
        },
        uzs: {
          columns: {
            id_zipcode_state: true,
            state: true,
            abbreviation: true,
          },
        },
      },
      columns: {
        zip_code: true,
        address1: true,
        address2: true,
        district: true,
        city_fiscal_code: true,
        state_fiscal_code: true,
      },
    });

    if (!result) {
      return null;
    }

    const cityName = result.uzc?.city ?? null;

    const stateName = this.formatStateName(result.uzs);

    return {
      country_id: result.uuc?.country_id ?? null,
      zip_code: result.zip_code,
      address1: result.address1,
      address2: result.address2,
      city: cityName,
      state: stateName,
      state_id: result.uzs?.id_zipcode_state ?? null,
      city_id: result.uzc?.id_zipcode_city ?? null,
      district: result.district,
    };
  };

  private readonly formatStateName = (
    uzs: {
      state: string;
      abbreviation: string | null;
    } | null
  ): string | null => {
    if (!uzs) return null;
    if (uzs.abbreviation) {
      return `${uzs.state} (${uzs.abbreviation})`;
    }

    return uzs.state;
  };
}
