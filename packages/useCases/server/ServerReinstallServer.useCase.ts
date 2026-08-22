import { injectable, inject } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { TFunction } from 'i18next';
import { SshService } from '@core/services/ssh.service';
import { ConnectConfig } from 'ssh2';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ServerReinstallServerUseCase {
  constructor(
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
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
    serverId: string,
    installationId: string
  ): Promise<void> {
    try {
      const payload: CreateServerResponse = {
        server_id: serverId,
        installation_id: installationId,
        force_install: true,
      };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.createServer(),
        payload,
        serverId
      );
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

    const currentStatus =
      await this.serverService.viewServerStatusByIdAuthoritative(serverId);

    if (currentStatus === null) {
      throw new Error(t('server_not_found'));
    }

    if (currentStatus === EServerStatus.installing) {
      throw new Error(t('server_reinstall_failed'));
    }

    const installationId = uuidv7();

    if (currentStatus === EServerStatus.new) {
      const pendingInstallationClaimed =
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.installing,
          [EServerStatus.new]
        );

      if (!pendingInstallationClaimed) {
        const latestStatus =
          await this.serverService.viewServerStatusByIdAuthoritative(serverId);
        if (latestStatus === EServerStatus.installing) {
          return true;
        }

        throw new Error(t('server_reinstall_failed'));
      }

      try {
        await this.onServerCreated(t, serverId, installationId);
        return true;
      } catch (error) {
        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.error,
          [EServerStatus.installing]
        );
        throw error;
      }
    }

    const statusUpdated = await this.serverService.updateServerStatusById(
      serverId,
      EServerStatus.new,
      [
        EServerStatus.online,
        EServerStatus.error,
        EServerStatus.offline,
        EServerStatus.canceled,
      ]
    );

    if (!statusUpdated) {
      const latestStatus =
        await this.serverService.viewServerStatusByIdAuthoritative(serverId);
      if (
        latestStatus === EServerStatus.new ||
        latestStatus === EServerStatus.installing
      ) {
        return true;
      }

      throw new Error(t('server_reinstall_failed'));
    }

    try {
      await this.serverService.deleteLogInstallServer(serverId);
      await this.onServerCreated(t, serverId, installationId);
      return true;
    } catch (error) {
      await this.serverService.updateServerStatusById(
        serverId,
        EServerStatus.error,
        [EServerStatus.new]
      );
      throw error;
    }
  }
}
