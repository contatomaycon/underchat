import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';

@injectable()
export class UserAllListerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  listAllUsers = async (accountId: string): Promise<ListAllUsersResponse[]> => {
    const result = await this.db.query.user.findMany({
      where: and(eq(user.account_id, accountId), isNull(user.deleted_at)),
      with: {
        uac: {
          columns: {
            account_id: true,
            name: true,
          },
        },
        uui: {
          columns: {
            name: true,
            last_name: true,
          },
        },
      },
      columns: {
        user_id: true,
      },
    });

    if (!result) {
      return [];
    }

    return result.map((user) => ({
      user_id: user.user_id,
      first_name: user.uui?.name || null,
      last_name: user.uui?.last_name || null,
      account_id: user.uac?.account_id || accountId,
      account_name: user.uac?.name || '',
    }));
  };
}
