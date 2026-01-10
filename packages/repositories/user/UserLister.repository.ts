import * as schema from '@core/models';
import {
  user,
  userStatus,
  userInfo,
  userAddress,
  userDocument,
  account,
  country,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  count,
  eq,
  isNull,
  SQLWrapper,
  or,
  ilike,
  inArray,
  SQL,
} from 'drizzle-orm';
import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { PresenceService } from '@core/services/presence.service';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

@injectable()
export class UserListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    private readonly presenceService: PresenceService
  ) {}

  private readonly setFiltersUser = (
    query: ListUserRequest,
    searchHashes: string | null
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    const searchTerm = query.search;
    if (!searchTerm) return filters;

    const rawConditions: Array<SQLWrapper | undefined> = [
      searchTerm ? ilike(user.email_partial, `%${searchTerm}%`) : undefined,
      searchTerm
        ? inArray(
            user.user_id,
            this.dbRo
              .select({ user_id: userInfo.user_id })
              .from(userInfo)
              .where(ilike(userInfo.phone_partial, `%${searchTerm}%`))
          )
        : undefined,
      searchTerm
        ? inArray(
            user.user_id,
            this.dbRo
              .select({ user_id: userDocument.user_id })
              .from(userDocument)
              .where(ilike(userDocument.document_partial, `%${searchTerm}%`))
          )
        : undefined,
      searchTerm
        ? inArray(
            user.account_id,
            this.dbRo
              .select({ account_id: account.account_id })
              .from(account)
              .where(ilike(account.name, `%${searchTerm}%`))
          )
        : undefined,
      searchHashes ? eq(user.email_c, searchHashes) : undefined,
      searchHashes
        ? inArray(
            user.user_id,
            this.dbRo
              .select({ user_id: userInfo.user_id })
              .from(userInfo)
              .where(eq(userInfo.phone_c, searchHashes))
          )
        : undefined,
      searchHashes
        ? inArray(
            user.user_id,
            this.dbRo
              .select({ user_id: userDocument.user_id })
              .from(userDocument)
              .where(eq(userDocument.document_c, searchHashes))
          )
        : undefined,
    ];

    const conditions = rawConditions.filter(isDefinedFilter);

    if (conditions.length) {
      const combinedFilter = or(...conditions) as SQLWrapper;
      filters.push(combinedFilter);
    }

    return filters;
  };

  private setFilters(query: ListUserRequest): SQL<unknown> | undefined {
    if (query.user_status) {
      return eq(user.user_status_id, query.user_status);
    }

    return undefined;
  }

  listUsers = async (
    perPage: number,
    currentPage: number,
    query: ListUserRequest,
    accountId: string | null,
    searchHashes: string | null
  ): Promise<ListUserResponse[]> => {
    const filtersUser = this.setFiltersUser(query, searchHashes);
    const filters = this.setFilters(query);

    const whereConditions = [
      isNull(user.deleted_at),
      filters,
      ...filtersUser,
    ].filter(isDefinedFilter);

    if (accountId !== null && accountId !== undefined) {
      whereConditions.push(eq(user.account_id, accountId));
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const result = await this.dbRo.query.user.findMany({
      where: whereClause,
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
        ucu: {
          columns: {
            chat_user_id: true,
          },
        },
        upa: {
          columns: {
            permission_assignment_id: true,
            permission_role_id: true,
          },
          with: {
            ppr: {
              columns: {
                permission_role_id: true,
                name: true,
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
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    const usersWithStatus = await Promise.all(
      result.map(async (userData) => {
        const status = await this.presenceService.getStatus(userData.user_id);
        return { userData, status: status ?? EChatUserStatus.offline };
      })
    );

    return usersWithStatus.map(({ userData: user, status }) => {
      const userAddressData =
        user.uua && !user.uua.deleted_at ? user.uua : null;

      return {
        user_id: user.user_id,
        account: user.uac
          ? {
              account_id: user.uac.account_id,
              name: user.uac.name,
            }
          : null,
        email_partial: user.email_partial,
        user_status: user.uus
          ? {
              user_status_id: user.uus.user_status_id,
              name: user.uus.name,
            }
          : null,
        user_info: user.uui
          ? {
              user_info_id: user.uui.user_info_id,
              phone_ddi: user.uui.phone_ddi,
              phone_partial: user.uui.phone_partial,
              name: user.uui.name,
              last_name: user.uui.last_name,
              birth_date: user.uui.birth_date,
              photo: user.uui.photo,
            }
          : null,
        user_document: user.uud
          ? {
              user_document_id: user.uud.user_document_id,
              document_partial: user.uud.document_partial,
              user_document_type: user.uud.udt
                ? {
                    user_document_type_id: user.uud.udt.user_document_type_id,
                    name: user.uud.udt.name,
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
              city: userAddressData.uzc?.city ?? null,
              state: (() => {
                if (!userAddressData.uzs) return null;
                if (userAddressData.uzs.abbreviation) {
                  return `${userAddressData.uzs.state} (${userAddressData.uzs.abbreviation})`;
                }
                return userAddressData.uzs.state;
              })(),
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
        chat_user: user.ucu
          ? {
              chat_user_id: user.ucu.chat_user_id,
              status: status,
            }
          : null,
        permission_role: user.upa?.ppr
          ? {
              permission_role_id: user.upa.ppr.permission_role_id,
              name: user.upa.ppr.name,
            }
          : null,
        created_at: user.created_at,
      };
    });
  };

  listUsersTotal = async (
    query: ListUserRequest,
    accountId: string | null,
    searchHashes: string | null
  ): Promise<number> => {
    const filtersUser = this.setFiltersUser(query, searchHashes);
    const filters = this.setFilters(query);

    const whereConditions = [
      isNull(user.deleted_at),
      filters,
      ...filtersUser,
    ].filter(isDefinedFilter);

    if (accountId !== null && accountId !== undefined) {
      whereConditions.push(eq(user.account_id, accountId));
    }

    const whereClause =
      whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const result = await this.dbRo
      .select({
        count: count(),
      })
      .from(user)
      .leftJoin(account, eq(user.account_id, account.account_id))
      .leftJoin(userStatus, eq(user.user_status_id, userStatus.user_status_id))
      .leftJoin(userInfo, eq(user.user_id, userInfo.user_id))
      .leftJoin(userAddress, eq(user.user_id, userAddress.user_id))
      .leftJoin(userDocument, eq(user.user_id, userDocument.user_id))
      .leftJoin(country, eq(userAddress.country_id, country.country_id))
      .where(whereClause)
      .execute();

    return result[0]?.count ?? 0;
  };
}
