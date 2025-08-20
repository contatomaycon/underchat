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
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';

@injectable()
export class UserListerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly setFiltersUser = (query: ListUserRequest): SQLWrapper[] => {
    const filters: SQLWrapper[] = [];

    if (
      query.username ||
      query.email_partial ||
      query.phone_partial ||
      query.document_partial
    ) {
      const conditions: (SQLWrapper | undefined)[] = [
        query.username
          ? ilike(user.username, `%${query.username}%`)
          : undefined,
        query.email_partial
          ? ilike(user.email_partial, `%${query.email_partial}%`)
          : undefined,
        query.phone_partial
          ? inArray(
              user.user_id,
              this.db
                .select({ user_id: userInfo.user_id })
                .from(userInfo)
                .where(
                  ilike(userInfo.phone_partial, `%${query.phone_partial}%`)
                )
            )
          : undefined,
        query.document_partial
          ? inArray(
              user.user_id,
              this.db
                .select({ user_id: userDocument.user_id })
                .from(userDocument)
                .where(
                  ilike(
                    userDocument.document_partial,
                    `%${query.document_partial}%`
                  )
                )
            )
          : undefined,
      ];

      const combined = or(...conditions);

      if (combined) filters.push(combined);
    }

    return filters;
  };

  private setFilters(
    accountId: string,
    query: ListUserRequest
  ): SQL<unknown> | undefined {
    if (query.user_status) {
      return inArray(
        user.user_status_id,
        this.db
          .select({
            user_status_id: userStatus.user_status_id,
          })
          .from(user)
          .innerJoin(
            userStatus,
            eq(userStatus.user_status_id, user.user_status_id)
          )
          .where(
            and(
              eq(user.user_status_id, userStatus.user_status_id),
              eq(user.account_id, accountId),
              eq(userStatus.user_status_id, query.user_status)
            )
          )
      );
    }

    return undefined;
  }

  listUsers = async (
    perPage: number,
    currentPage: number,
    query: ListUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListUserResponse[]> => {
    const filtersUser = this.setFiltersUser(query);
    const filters = this.setFilters(accountId, query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(user.account_id, accountId);

    const result = await this.db.query.user.findMany({
      where: and(
        accountCondition,
        isNull(user.deleted_at),
        filters,
        ...filtersUser
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
            city: true,
            state: true,
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
          },
        },
      },
      columns: {
        user_id: true,
        username: true,
        email_partial: true,
        created_at: true,
      },
      limit: perPage,
      offset: (currentPage - 1) * perPage,
    });

    if (!result) {
      return [];
    }

    return result.map((user) => ({
      user_id: user.user_id,
      account: user.aac
        ? {
            account_id: user.aac.account_id,
            name: user.aac.name,
          }
        : null,
      username: user.username,
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
      user_address: user.uua
        ? {
            user_address_id: user.uua.user_address_id,
            zip_code: user.uua.zip_code,
            address1_partial: user.uua.address1_partial,
            address2_partial: user.uua.address2_partial,
            city: user.uua.city,
            state: user.uua.state,
            district: user.uua.district,
            country: user.uua.uuc
              ? {
                  country_id: user.uua.uuc.country_id,
                  iso_code: user.uua.uuc.iso_code,
                  name: user.uua.uuc.name,
                }
              : null,
          }
        : null,
      created_at: user.created_at,
    }));
  };

  listUsersTotal = async (
    query: ListUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<number> => {
    const filtersUser = this.setFiltersUser(query);
    const filters = this.setFilters(accountId, query);
    const accountCondition = isAdministrator
      ? undefined
      : eq(user.account_id, accountId);

    const result = await this.db
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
      .where(
        and(accountCondition, isNull(user.deleted_at), filters, ...filtersUser)
      )
      .execute();

    return result[0]?.count ?? 0;
  };
}
