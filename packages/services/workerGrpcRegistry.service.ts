import { injectable, inject } from 'tsyringe';
import { ServerWebViewerRepository } from '@core/repositories/server/ServerWebViewer.repository';
import { balanceEnvironment } from '@core/config/environments';

@injectable()
export class WorkerGrpcRegistryService {
  constructor(
    @inject(ServerWebViewerRepository)
    private readonly serverWebViewerRepository: ServerWebViewerRepository
  ) {}

  async getAddress(serverId: string): Promise<{ host: string; port: number }> {
    const view =
      await this.serverWebViewerRepository.viewServerWebById(serverId);

    if (!view) {
      throw new Error(`Server not found: ${serverId}`);
    }

    return {
      host: view.web_domain,
      port: balanceEnvironment.grpcPort,
    };
  }
}
