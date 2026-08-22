import {
  downloadArtifactCatalog,
  downloadArtifactCatalogByKey,
} from '@core/common/constants/downloadArtifacts';
import { DownloadArtifactConfigRepository } from '@core/repositories/config/DownloadArtifactConfig.repository';
import { DownloadArtifactsResponse } from '@core/schema/config/downloadArtifacts/response.schema';
import { inject, injectable } from 'tsyringe';

@injectable()
export class DownloadArtifactsViewerUseCase {
  constructor(
    @inject(DownloadArtifactConfigRepository)
    private readonly downloadArtifactConfigRepository: DownloadArtifactConfigRepository
  ) {}

  async execute(): Promise<DownloadArtifactsResponse> {
    const records = await this.downloadArtifactConfigRepository.list();
    const recordsByKey = new Map(
      records.map((record) => [record.artifact_key, record])
    );

    return {
      artifacts: downloadArtifactCatalog.map((artifact) => {
        const record = recordsByKey.get(artifact.artifact_key);

        return {
          artifact_key: artifact.artifact_key,
          product: artifact.product,
          environment: artifact.environment,
          platform: artifact.platform,
          label: artifact.label,
          filename: artifact.filename,
          url: recordsByKey.has(artifact.artifact_key)
            ? (record?.url ?? null)
            : artifact.default_url,
          updated_at: record?.updated_at ?? null,
        };
      }),
    };
  }

  isKnownArtifactKey(artifactKey: string): boolean {
    return downloadArtifactCatalogByKey.has(artifactKey);
  }
}
