import * as schema from '@core/models';
import { userInfo } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull } from 'drizzle-orm';

@injectable()
export class UserInfoViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  findUserInfoByUserId = async (userId: string) => {
    return this.db.query.userInfo.findFirst({
      where: and(eq(userInfo.user_id, userId), isNull(userInfo.deleted_at)),
      columns: {
        phone: true,
        phone_ddi: true,
        phone_jid: true,
        name: true,
        last_name: true,
      },
    });
  };
}
