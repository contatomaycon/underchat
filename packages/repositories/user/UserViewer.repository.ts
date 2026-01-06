import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';

@injectable()
export class UserViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewUserById = async (
    userId: string,
    accountId: string
  ): Promise<ViewUserResponse | null> => {
    const result = await this.dbRo.query.user.findFirst({
      where: and(
        eq(user.account_id, accountId),
        isNull(user.deleted_at),
        eq(user.user_id, userId)
      ),
      with: {
        uac: {
          columns: {
            account_id: true,
            name: true,
          },
        },
        uus: {
          columns: {
            user_status_id: true,
            name: true,
          },
        },
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
        uua: {
          columns: {
            user_address_id: true,
            zip_code: true,
            address1_partial: true,
            address2_partial: true,
            city_fiscal_code: true,
            state_fiscal_code: true,
            district: true,
            deleted_at: true,
          },
          with: {
            uuc: {
              columns: {
                country_id: true,
                iso_code: true,
                name: true,
              },
            },
            uzc: {
              columns: {
                city: true,
              },
            },
            uzs: {
              columns: {
                state: true,
                abbreviation: true,
              },
            },
          },
        },
      },
      columns: {
        user_id: true,
        email_partial: true,
        created_at: true,
      },
    });

    if (!result) {
      return null;
    }

    const userAddressData =
      result.uua && !result.uua.deleted_at ? result.uua : null;

    const cityName = userAddressData?.uzc?.city ?? null;
    let stateName: string | null = null;
    if (userAddressData?.uzs) {
      if (userAddressData.uzs.abbreviation) {
        stateName = `${userAddressData.uzs.state} (${userAddressData.uzs.abbreviation})`;
      }
      if (!userAddressData.uzs.abbreviation) {
        stateName = userAddressData.uzs.state;
      }
    }

    const userById: ViewUserResponse = {
      user_id: result.user_id,
      account: {
        account_id: result.uac.account_id,
        name: result.uac.name,
      },
      email_partial: result.email_partial,
      user_status: result.uus
        ? {
            user_status_id: result.uus.user_status_id,
            name: result.uus.name,
          }
        : null,
      user_info: result.uui
        ? {
            user_info_id: result.uui.user_info_id,
            phone_ddi: result.uui.phone_ddi,
            phone_partial: result.uui.phone_partial,
            name: result.uui.name,
            last_name: result.uui.last_name,
            birth_date: result.uui.birth_date,
            photo: result.uui.photo,
          }
        : null,
      user_document: result.uud
        ? {
            user_document_id: result.uud.user_document_id,
            document_partial: result.uud.document_partial,
            user_document_type: result.uud.udt
              ? {
                  user_document_type_id: result.uud.udt.user_document_type_id,
                  name: result.uud.udt.name,
                }
              : null,
          }
        : null,
      user_address: userAddressData
        ? {
            user_address_id: userAddressData.user_address_id,
            zip_code: userAddressData.zip_code,
            address1_partial: userAddressData.address1_partial,
            address2_partial: userAddressData.address2_partial,
            city: cityName,
            state: stateName,
            city_fiscal_code: userAddressData.city_fiscal_code,
            state_fiscal_code: userAddressData.state_fiscal_code,
            district: userAddressData.district,
            country: userAddressData.uuc
              ? {
                  country_id: userAddressData.uuc.country_id,
                  iso_code: userAddressData.uuc.iso_code,
                  name: userAddressData.uuc.name,
                }
              : null,
          }
        : null,
      created_at: result.created_at,
    };

    return userById;
  };
}
