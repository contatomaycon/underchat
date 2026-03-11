import { inject, injectable } from 'tsyringe';
import { ServerBuildViewResponse } from '@core/schema/server/viewServerBuild/response.schema';
import { ServerBuildService } from '@core/services/serverBuild.service';

@injectable()
export class ServerBuildViewerUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService
  ) {}

  async execute(): Promise<ServerBuildViewResponse> {
    return this.serverBuildService.listBuilds();
  }
}
