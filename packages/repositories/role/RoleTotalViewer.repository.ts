import * as schema from '@core/models';
import { permissionRole } from '@core/models';
import { and, count, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class RoleTotalViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  totalRoleByAccount = async (accountId: string): Promise<number> => {
    const result = await this.db
      .select({
        total: count(),
      })
      .from(permissionRole)
      .where(
        and(
          eq(permissionRole.account_id, accountId),
          isNull(permissionRole.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return 0;
    }

    return result[0].total;
  };
}
