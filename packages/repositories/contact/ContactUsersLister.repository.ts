import * as schema from '@core/models';
import { user } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';
import { ListContactUsersResponse } from '@core/schema/contact/listUsers/response.schema';

@injectable()
export class ContactUsersListerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  listContactUsers = async (
    accountId: string
  ): Promise<ListContactUsersResponse[]> => {
    const result = await this.dbRo.query.user.findMany({
      where: and(eq(user.account_id, accountId), isNull(user.deleted_at)),
      with: {
        uui: {
          columns: {
            name: true,
            last_name: true,
            photo: true,
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

    return result.map((u) => ({
      user_id: u.user_id,
      name: u.uui
        ? [u.uui.name, u.uui.last_name].filter(Boolean).join(' ') || null
        : null,
      photo: u.uui?.photo || null,
    }));
  };
}
