import * as schema from '@core/models';
import { releaseView } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, inArray } from 'drizzle-orm';

@injectable()
export class ReleaseViewViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsReleaseView = async (
    releaseId: string,
    userId: string
  ): Promise<boolean> => {
    const existingView = await this.dbRo.query.releaseView.findFirst({
      where: and(
        eq(releaseView.release_id, releaseId),
        eq(releaseView.user_id, userId)
      ),
    });

    return !!existingView;
  };

  findViewedReleaseIds = async (
    releaseIds: string[],
    userId: string
  ): Promise<Set<string>> => {
    if (releaseIds.length === 0) {
      return new Set();
    }

    const viewedReleases = await this.dbRo
      .select({
        release_id: releaseView.release_id,
      })
      .from(releaseView)
      .where(
        and(
          inArray(releaseView.release_id, releaseIds),
          eq(releaseView.user_id, userId)
        )
      )
      .execute();

    return new Set(viewedReleases.map((item) => item.release_id));
  };
}
