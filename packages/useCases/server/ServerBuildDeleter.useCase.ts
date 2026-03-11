import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { IDeleteServerBuildResult } from '@core/common/interfaces/IDeleteServerBuildResult';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

type ServerBuildDeleteResult =
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
      data: IDeleteServerBuildResult;
    };

@injectable()
export class ServerBuildDeleterUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(ServerBuildHarborService)
    private readonly serverBuildHarborService: ServerBuildHarborService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverBuildJobId: string
  ): Promise<ServerBuildDeleteResult> {
    const job =
      await this.serverBuildService.getBuildJobSummaryById(serverBuildJobId);
    if (!job) {
      return { status: 'not_found' };
    }

    if (
      job.status === EServerBuildJobStatus.queued ||
      job.status === EServerBuildJobStatus.running ||
      job.status === EServerBuildJobStatus.cancel_requested
    ) {
      return { status: 'conflict_active' };
    }

    const isDefault = await this.serverBuildService.isBuildVersionDefault(
      job.version
    );
    if (isDefault) {
      return { status: 'conflict_default' };
    }

    try {
      await this.serverBuildHarborService.deleteBuildVersionArtifacts(
        job.version
      );
    } catch {
      throw new Error(t('server_build_delete_harbor_error'));
    }

    const deleted = await this.serverBuildService.hardDeleteBuildByVersion(
      job.version
    );

    return {
      status: 'deleted',
      data: deleted,
    };
  }
}
