import { inject, injectable } from 'tsyringe';
import { ServerBuildDefaultResponse } from '@core/schema/server/setServerBuildDefault/response.schema';
import { ServerBuildService } from '@core/services/serverBuild.service';

@injectable()
export class ServerBuildDefaultUpdaterUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService
  ) {}

  async execute(
    serverBuildVersionId: string
  ): Promise<ServerBuildDefaultResponse | null> {
    return this.serverBuildService.setDefaultVersion(serverBuildVersionId);
  }
}
