import * as schema from '@core/models';
import {
  user,
  userAddress,
  country,
  zipcodeCity,
  zipcodeState,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';

@injectable()
export class UserInfoViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  viewUserInfo = async (
    userId: string
  ): Promise<ViewUserInfoResponse | null> => {
    const [userResult, addressResult] = await Promise.all([
      this.fetchUser(userId),
      this.fetchUserAddress(userId),
    ]);

    if (!userResult) {
      return null;
    }

    return this.buildResponse(userResult, addressResult);
  };

  private readonly fetchUser = async (userId: string) => {
    return this.dbRw.query.user.findFirst({
      where: and(isNull(user.deleted_at), eq(user.user_id, userId)),
      with: {
        uui: {
          columns: {
            user_info_id: true,
            phone_ddi: true,
            phone_partial: true,
            name: true,
            last_name: true,
            birth_date: true,
            photo: true,
          },
        },
        uud: {
          columns: {
            user_document_id: true,
            document_partial: true,
          },
          with: {
            udt: {
              columns: {
                user_document_type_id: true,
                name: true,
              },
            },
          },
        },
      },
      columns: {
        user_id: true,
        email_partial: true,
      },
    });
  };

  private readonly fetchUserAddress = async (userId: string) => {
    const result = await this.dbRw
      .select({
        user_address_id: userAddress.user_address_id,
        zip_code: userAddress.zip_code,
        address1_partial: userAddress.address1_partial,
        address2_partial: userAddress.address2_partial,
        district: userAddress.district,
        uuc: {
          country_id: country.country_id,
          iso_code: country.iso_code,
          name: country.name,
        },
        uzc: {
          city: zipcodeCity.city,
        },
        uzs: {
          state: zipcodeState.state,
          abbreviation: zipcodeState.abbreviation,
        },
      })
      .from(userAddress)
      .leftJoin(country, eq(userAddress.country_id, country.country_id))
      .leftJoin(
        zipcodeCity,
        eq(userAddress.city_fiscal_code, zipcodeCity.fiscal_code)
      )
      .leftJoin(
        zipcodeState,
        eq(userAddress.state_fiscal_code, zipcodeState.fiscal_code)
      )
      .where(
        and(eq(userAddress.user_id, userId), isNull(userAddress.deleted_at))
      )
      .limit(1)
      .execute();

    return result.length > 0 ? result[0] : null;
  };

  private readonly buildResponse = (
    userResult: NonNullable<Awaited<ReturnType<typeof this.fetchUser>>>,
    addressResult: Awaited<ReturnType<typeof this.fetchUserAddress>>
  ): ViewUserInfoResponse => {
    return {
      user_id: userResult.user_id,
      email_partial: userResult.email_partial,
      user_info: this.buildUserInfo(userResult.uui),
      user_document: this.buildUserDocument(userResult.uud),
      user_address: this.buildUserAddress(addressResult),
    };
  };

  private readonly buildUserInfo = (
    uui: NonNullable<Awaited<ReturnType<typeof this.fetchUser>>>['uui']
  ): ViewUserInfoResponse['user_info'] => {
    if (!uui) {
      return null;
    }

    return {
      user_info_id: uui.user_info_id,
      phone_ddi: uui.phone_ddi,
      phone_partial: uui.phone_partial,
      name: uui.name,
      last_name: uui.last_name,
      birth_date: uui.birth_date,
      photo: uui.photo,
    };
  };

  private readonly buildUserDocument = (
    uud: NonNullable<Awaited<ReturnType<typeof this.fetchUser>>>['uud']
  ): ViewUserInfoResponse['user_document'] => {
    if (!uud) {
      return null;
    }

    return {
      user_document_id: uud.user_document_id,
      document_partial: uud.document_partial,
      user_document_type: this.buildDocumentType(uud.udt),
    };
  };

  private readonly buildDocumentType = (
    udt: { user_document_type_id: string; name: string } | null | undefined
  ): NonNullable<
    ViewUserInfoResponse['user_document']
  >['user_document_type'] => {
    if (!udt) {
      return null;
    }

    return {
      user_document_type_id: udt.user_document_type_id,
      name: udt.name,
    };
  };

  private readonly buildUserAddress = (
    addressResult: Awaited<ReturnType<typeof this.fetchUserAddress>>
  ): ViewUserInfoResponse['user_address'] => {
    if (!addressResult) {
      return null;
    }

    return {
      user_address_id: addressResult.user_address_id,
      zip_code: addressResult.zip_code,
      address1_partial: addressResult.address1_partial,
      address2_partial: addressResult.address2_partial,
      city: addressResult.uzc?.city ?? null,
      state: this.formatStateName(addressResult.uzs),
      district: addressResult.district,
      country: this.buildCountry(addressResult.uuc),
    };
  };

  private readonly buildCountry = (
    uuc: { country_id: number; iso_code: string; name: string } | null
  ): NonNullable<ViewUserInfoResponse['user_address']>['country'] => {
    if (!uuc) {
      return null;
    }

    return {
      country_id: uuc.country_id,
      iso_code: uuc.iso_code,
      name: uuc.name,
    };
  };

  private readonly formatStateName = (
    uzs: { state: string; abbreviation: string | null } | null
  ): string | null => {
    if (!uzs) {
      return null;
    }

    if (uzs.abbreviation) {
      return `${uzs.state} (${uzs.abbreviation})`;
    }

    return uzs.state;
  };
}
