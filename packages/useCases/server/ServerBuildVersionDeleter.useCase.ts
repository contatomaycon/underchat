import { IDeleteServerBuildVersionResult } from '@core/common/interfaces/IDeleteServerBuildVersionResult';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

type ServerBuildVersionDeleteResult =
  | {
      status: 'not_found';
    }
  | {
      status: 'conflict_active';
    }
  | {
      status: 'conflict_default';
    }
  | {
      status: 'deleted';
      data: IDeleteServerBuildVersionResult;
    };

@injectable()
export class ServerBuildVersionDeleterUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(ServerBuildHarborService)
    private readonly serverBuildHarborService: ServerBuildHarborService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverBuildVersionId: string
  ): Promise<ServerBuildVersionDeleteResult> {
    const buildVersion =
      await this.serverBuildService.getBuildVersionById(serverBuildVersionId);
    if (!buildVersion) {
      return { status: 'not_found' };
    }

    if (buildVersion.is_default) {
      return { status: 'conflict_default' };
    }

    const hasActiveBuild =
      await this.serverBuildService.hasActiveBuildJobForVersion(
        buildVersion.version
      );
    if (hasActiveBuild) {
      return { status: 'conflict_active' };
    }

    try {
      await this.serverBuildHarborService.deleteBuildVersionArtifact(
        buildVersion.build_type,
        buildVersion.version
      );
    } catch {
      throw new Error(t('server_build_version_delete_harbor_error'));
    }

    const deleted =
      await this.serverBuildService.hardDeleteBuildVersionById(
        serverBuildVersionId
      );
    if (!deleted) {
      const current =
        await this.serverBuildService.getBuildVersionById(serverBuildVersionId);
      return current?.is_default
        ? { status: 'conflict_default' }
        : { status: 'not_found' };
    }

    return {
      status: 'deleted',
      data: {
        server_build_version_id: buildVersion.server_build_version_id,
        build_type: buildVersion.build_type,
        version: buildVersion.version,
      },
    };
  }
}
