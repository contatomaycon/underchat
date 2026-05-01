import * as schema from '@core/models';
import { user, userInfo } from '@core/models';
import {
  and,
  asc,
  count,
  eq,
  ilike,
  isNull,
  ne,
  SQLWrapper,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IInternalChatUserNamePhoto } from '@core/common/interfaces/internalChat/IInternalChatUserNamePhoto';
import {
  IInternalChatListUsersFromAccountInput,
  IInternalChatListUsersFromAccountResult,
} from '@core/common/interfaces/internalChat/IInternalChatUserRepositoryContracts';

@injectable()
export class InternalChatUserRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async listUsersFromAccount(
    input: IInternalChatListUsersFromAccountInput
  ): Promise<IInternalChatListUsersFromAccountResult> {
    const filters: SQLWrapper[] = [
      eq(user.account_id, input.accountId),
      isNull(user.deleted_at),
      isNull(userInfo.deleted_at),
    ];

    if (input.exceptUserId) {
      filters.push(ne(user.user_id, input.exceptUserId));
    }

    const search = input.search?.trim();
    if (search) {
      filters.push(ilike(userInfo.name, `%${search}%`));
    }

    const [rows, totalRows] = await Promise.all([
      this.listUsersRows(input, filters),
      this.countUsersRows(filters),
    ]);

    return {
      rows: rows.map((row) => ({
        user_id: row.user_id,
        name: row.name,
        photo: row.photo ?? null,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async viewUserNamePhoto(
    userId: string
  ): Promise<IInternalChatUserNamePhoto | null> {
    const rows = await this.dbRo
      .select({
        user_id: user.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(user)
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(and(eq(user.user_id, userId), isNull(user.deleted_at)))
      .limit(1)
      .execute();

    if (!rows[0]) {
      return null;
    }

    return {
      user_id: rows[0].user_id,
      name: rows[0].name,
      photo: rows[0].photo ?? null,
    };
  }

  private listUsersRows(
    input: IInternalChatListUsersFromAccountInput,
    filters: SQLWrapper[]
  ) {
    const where = and(...filters);

    return this.dbRo
      .select({
        user_id: user.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(user)
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(where)
      .orderBy(asc(userInfo.name))
      .limit(input.perPage)
      .offset((input.currentPage - 1) * input.perPage)
      .execute();
  }

  private countUsersRows(filters: SQLWrapper[]) {
    const where = and(...filters);

    return this.dbRo
      .select({ total: count() })
      .from(user)
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(where)
      .execute();
  }
}
