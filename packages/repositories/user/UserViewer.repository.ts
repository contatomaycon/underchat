import * as schema from '@core/models';
import { user, zipcodeState, zipcodeCity } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';

@injectable()
export class UserViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewUserById = async (
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewUserResponse | null> => {
    const accountCondition = isAdministrator
      ? undefined
      : eq(user.account_id, accountId);

    const result = await this.db.query.user.findFirst({
      where: and(
        accountCondition,
        isNull(user.deleted_at),
        eq(user.user_id, userId)
      ),
      with: {
        aac: {
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

    const cityName = result.uua?.uzc?.city ?? null;
    const stateName = result.uua?.uzs
      ? result.uua.uzs.abbreviation
        ? `${result.uua.uzs.state} (${result.uua.uzs.abbreviation})`
        : result.uua.uzs.state
      : null;

    const userById: ViewUserResponse = {
      user_id: result.user_id,
      account: {
        account_id: result.aac.account_id,
        name: result.aac.name,
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
      user_address: result.uua
        ? {
            user_address_id: result.uua.user_address_id,
            zip_code: result.uua.zip_code,
            address1_partial: result.uua.address1_partial,
            address2_partial: result.uua.address2_partial,
            city: cityName,
            state: stateName,
            city_fiscal_code: result.uua.city_fiscal_code,
            state_fiscal_code: result.uua.state_fiscal_code,
            district: result.uua.district,
            country: result.uua.uuc
              ? {
                  country_id: result.uua.uuc.country_id,
                  iso_code: result.uua.uuc.iso_code,
                  name: result.uua.uuc.name,
                }
              : null,
          }
        : null,
      created_at: result.created_at,
    };

    return userById;
  };
}
