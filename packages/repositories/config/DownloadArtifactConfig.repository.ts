import * as schema from '@core/models';
import { downloadArtifactConfig } from '@core/models';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

export type DownloadArtifactConfigRecord =
  typeof downloadArtifactConfig.$inferSelect;

@injectable()
export class DownloadArtifactConfigRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  list = async (): Promise<DownloadArtifactConfigRecord[]> => {
    return this.dbRo.query.downloadArtifactConfig.findMany({
      orderBy: (table, { asc }) => [asc(table.artifact_key)],
    });
  };

  upsertMany = async (
    artifacts: Array<{ artifact_key: string; url: string | null }>
  ): Promise<void> => {
    await this.dbRw.transaction(async (tx) => {
      for (const artifact of artifacts) {
        const existing = await tx.query.downloadArtifactConfig.findFirst({
          where: eq(downloadArtifactConfig.artifact_key, artifact.artifact_key),
        });

        if (!existing) {
          await tx.insert(downloadArtifactConfig).values({
            download_artifact_config_id: uuidv7(),
            artifact_key: artifact.artifact_key,
            url: artifact.url,
          });
          continue;
        }

        await tx
          .update(downloadArtifactConfig)
          .set({
            url: artifact.url,
            updated_at: currentTime(),
          })
          .where(
            eq(
              downloadArtifactConfig.download_artifact_config_id,
              existing.download_artifact_config_id
            )
          );
      }
    });
  };
}
