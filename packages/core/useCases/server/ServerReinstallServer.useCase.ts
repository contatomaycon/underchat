import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { SshService } from '@core/services/ssh.service';
import { ConnectConfig } from 'ssh2';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';

@injectable()
export class ServerReinstallServerUseCase {
  constructor(
    private readonly serverService: ServerService,
    private readonly sshService: SshService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<void> {
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
      host: viewServerSshById.ssh_ip,
      port: viewServerSshById.ssh_port,
      username: sshUsernameDescrypted,
      password: sshPasswordDescrypted,
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

  async onServerCreated(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<void> {
    try {
      const payload: CreateServerResponse = {
        server_id: serverId,
      };

      await this.streamProducerService.send('create.server', payload);
    } catch {
      throw new Error(t('kafka_error'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    serverId: string
  ): Promise<boolean> {
    await this.validate(t, serverId);

    const exists = await this.serverService.existsServerById(serverId);

    if (!exists) {
      throw new Error(t('server_not_found'));
    }

    await this.onServerCreated(t, serverId);

    return this.serverService.
      serverId,
      EServerStatus.new
    );
  }
}
