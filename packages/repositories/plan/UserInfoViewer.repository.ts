import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';

@injectable()
export class UserInfoViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewUserInfo = async (
    userId: string
  ): Promise<ViewUserInfoResponse | null> => {
    const result = await this.db.query.user.findFirst({
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
        uua: {
          columns: {
            user_address_id: true,
            zip_code: true,
            address1_partial: true,
            address2_partial: true,
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
      },
    });

    if (!result) {
      return null;
    }

    const cityName = result.uua?.uzc?.city ?? null;
    let stateName: string | null = null;
    if (result.uua?.uzs) {
      if (result.uua.uzs.abbreviation) {
        stateName = `${result.uua.uzs.state} (${result.uua.uzs.abbreviation})`;
      } else {
        stateName = result.uua.uzs.state;
      }
    }

    const userInfo: ViewUserInfoResponse = {
      user_id: result.user_id,
      email_partial: result.email_partial,
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
    };

    return userInfo;
  };
}
