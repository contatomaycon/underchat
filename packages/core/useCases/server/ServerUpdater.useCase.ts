import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { SshService } from '@core/services/ssh.service';
import { ConnectConfig } from 'ssh2';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

@injectable()
export class ServerUpdaterUseCase {
  constructor(
    private readonly serverService: ServerService,
    private readonly sshService: SshService,
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    serverId: number,
    input: EditServerRequest
  ): Promise<void> {
    const serverExists = await this.serverService.existsServerNotIdAndByIp(
      serverId,
      input.ssh_ip
    );

    if (serverExists) {
      throw new Error(t('server_already_exists'));
    }

    const viewServerSshById =
      await this.serverService.viewServerSshById(serverId);

    if (!viewServerSshById) {
      throw new Error(t('server_ssh_not_found'));
    }

    const sshUsernameDescrypted = this.passwordEncryptorService.decrypt(
      viewServerSshById.ssh_username
    );
    const sshPasswordDescrypted = this.passwordEncryptorService.decrypt(
      viewServerSshById.ssh_password
    );

    const sshConfig: ConnectConfig = {
      host: input.ssh_ip,
      port: input.ssh_port,
      username: input.ssh_username || sshUsernameDescrypted,
      password: input.ssh_password || sshPasswordDescrypted,
    };

    const isConnected = await this.sshService.testSSHConnection(sshConfig);

    if (!isConnected) {
      throw new Error(t('ssh_connection_failed'));
    }

    const getDistroAndVersion =
      await this.sshService.getDistroAndVersion(sshConfig);

    if (!getDistroAndVersion) {
      throw new Error(t('ssh_distro_version_failed'));
    }

    const isAllowed = isDistroVersionAllowed(getDistroAndVersion);

    if (!isAllowed) {
      throw new Error(t('ssh_distro_version_not_allowed'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: number,
    body: EditServerRequest
  ): Promise<boolean> {
    await this.validate(t, serverId, body);

    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    return this.serverService.updateServerById(t, serverId, body);
  }
}
