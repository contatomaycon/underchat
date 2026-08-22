import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ServerService } from '@core/services/server.service';
import { SshService } from '@core/services/ssh.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';

@injectable()
export class ServerCancelInstallUseCase {
  constructor(
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<boolean> {
    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    const currentStatus =
      await this.serverService.viewServerStatusByIdAuthoritative(serverId);

    if (currentStatus === null) {
      throw new Error(t('server_not_found'));
    }

    if (currentStatus !== EServerStatus.installing) {
      throw new Error(t('server_cancel_install_invalid_status'));
    }

    this.sshService.cancelServerExecution(serverId);

    return this.serverService.updateServerStatusById(
      serverId,
      EServerStatus.canceled,
      [EServerStatus.installing]
    );
  }
}
