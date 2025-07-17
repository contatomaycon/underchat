import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { TFunction } from 'i18next';

@injectable()
export class ServerCreatorUseCase {
  constructor(private readonly serverService: ServerService) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: CreateServerRequest
  ): Promise<void> {
    const serverExists = await this.serverService.viewByIp(input.ssh_ip);

    if (serverExists) {
      throw new Error(t('server_already_exists'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateServerRequest
  ): Promise<CreateServerResponse | null> {
    await this.validate(t, input);

    const serverId = await this.serverService.createServer(input);

    if (!serverId) {
      throw new Error(t('server_creator_error'));
    }

    const serverSshId = await this.serverService.createServerSsh(
      input,
      serverId
    );

    if (!serverSshId) {
      throw new Error(t('server_ssh_creator_error'));
    }

    return {
      server_id: serverId,
    };
  }
}
