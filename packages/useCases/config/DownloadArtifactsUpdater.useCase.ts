import { downloadArtifactCatalogByKey } from '@core/common/constants/downloadArtifacts';
import { DownloadArtifactConfigRepository } from '@core/repositories/config/DownloadArtifactConfig.repository';
import { UpdateDownloadArtifactsRequest } from '@core/schema/config/downloadArtifacts/request.schema';
import { DownloadArtifactsResponse } from '@core/schema/config/downloadArtifacts/response.schema';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';
import { DownloadArtifactsViewerUseCase } from './DownloadArtifactsViewer.useCase';

@injectable()
export class DownloadArtifactsUpdaterUseCase {
  constructor(
    @inject(DownloadArtifactConfigRepository)
    private readonly downloadArtifactConfigRepository: DownloadArtifactConfigRepository,
    @inject(DownloadArtifactsViewerUseCase)
    private readonly downloadArtifactsViewerUseCase: DownloadArtifactsViewerUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: UpdateDownloadArtifactsRequest
  ): Promise<DownloadArtifactsResponse> {
    const normalized = input.artifacts.map((artifact) => ({
      artifact_key: artifact.artifact_key.trim(),
      url: artifact.url?.trim() || null,
    }));

    for (const artifact of normalized) {
      if (!downloadArtifactCatalogByKey.has(artifact.artifact_key)) {
        throw new Error(t('download_artifact_unknown'));
      }

      if (artifact.url && !/^https?:\/\/\S+$/u.test(artifact.url)) {
        throw new Error(t('download_artifact_url_invalid'));
      }
    }

    await this.downloadArtifactConfigRepository.upsertMany(normalized);

    return this.downloadArtifactsViewerUseCase.execute();
  }
}
