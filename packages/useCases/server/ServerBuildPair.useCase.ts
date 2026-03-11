import { IPairServerBuildResult } from '@core/common/interfaces/IPairServerBuildResult';
import { ServerBuildHarborService } from '@core/services/serverBuildHarbor.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ServerBuildPairUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(ServerBuildHarborService)
    private readonly serverBuildHarborService: ServerBuildHarborService
  ) {}

  async execute(): Promise<IPairServerBuildResult> {
    const result: IPairServerBuildResult = {
      imported_versions: 0,
      created_jobs: 0,
      created_versions: 0,
      skipped_versions: 0,
    };

    const versions =
      await this.serverBuildHarborService.listPairedBuildVersions(5);

    for (const versionData of versions) {
      const paired =
        await this.serverBuildService.pairBuildVersionFromHarbor(versionData);

      result.created_jobs += paired.created_jobs;
      result.created_versions += paired.created_versions;

      if (paired.imported) {
        result.imported_versions += 1;
      } else {
        result.skipped_versions += 1;
      }
    }

    return result;
  }
}
