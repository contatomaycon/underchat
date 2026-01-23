import * as schema from '@core/models';
import { releaseView } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq } from 'drizzle-orm';

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
}
