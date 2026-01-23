import * as schema from '@core/models';
import { releaseAccess } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

@injectable()
export class ReleaseAccessViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsReleaseAccessByUserId = async (
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        release_access_id: releaseAccess.release_access_id,
      })
      .from(releaseAccess)
      .where(
        and(
          eq(releaseAccess.release_id, releaseId),
          eq(releaseAccess.user_id, userId)
        )
      )
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
