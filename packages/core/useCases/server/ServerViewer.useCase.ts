import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { ViewServerResponse } from '@core/schema/server/viewServer/response.schema';

@injectable()
export class ServerViewerUseCase {
  constructor(private readonly serverService: ServerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<ViewServerResponse | null> {
    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    return this.serverService.viewServerById(serverId);
  }
}
