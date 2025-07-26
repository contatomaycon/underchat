import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';

@injectable()
export class ServerDeleterUseCase {
  constructor(private readonly serverService: ServerService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<boolean> {
    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    const [deleteServerSshById, deleteServerById] = await Promise.all([
      this.serverService.deleteServerSshById(serverId),
      this.serverService.deleteServerById(serverId),
    ]);

    if (!deleteServerSshById || !deleteServerById) {
      throw new Error(t('server_deleter_error'));
    }

    return true;
  }
}
