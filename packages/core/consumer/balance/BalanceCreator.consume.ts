import { injectable, inject } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { SshService } from '@core/services/ssh.service';
import { ServerService } from '@core/services/server.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ConnectConfig } from 'ssh2';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { FastifyInstance } from 'fastify';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

@injectable()
export class BalanceCreatorConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  private async validate(serverId: string): Promise<{
    getDistroAndVersion: IDistroInfo;
    sshConfig: ConnectConfig;
    webView: IViewServerWebById;
  }> {
    const [sshView, webView] = await Promise.all([
      this.serverService.viewServerSshById(serverId),
      this.serverService.viewServerWebById(serverId),
    ]);

    if (!sshView) {
      throw new Error('SSH configuration not found');
    }

    if (!webView) {
      throw new Error('Web configuration not found');
    }

    if (sshView.server_status_id !== EServerStatus.new) {
      throw new Error('Server is not in new status');
    }

    const sshConfig: ConnectConfig = {
      host: sshView.ssh_ip,
      port: sshView.ssh_port,
      username: this.passwordEncryptorService.decrypt(sshView.ssh_username),
      password: this.passwordEncryptorService.decrypt(sshView.ssh_password),
    };

    const connected = await this.sshService.testSSHConnection(sshConfig);

    if (!connected) {
      throw new Error('SSH connection failed');
    }

    const distro = await this.sshService.getDistroAndVersion(sshConfig);

    if (!distro) {
      throw new Error('Failed to retrieve distribution and version');
    }

    if (!isDistroVersionAllowed(distro)) {
      throw new Error('Distribution and version not allowed');
    }

    return { getDistroAndVersion: distro, sshConfig, webView };
  }

  private async isInstalled(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    webView: IViewServerWebById,
    attempts = 20
  ): Promise<boolean> {
    if (!sshConfig.host) {
      throw new Error('SSH host is not defined');
    }

    const commands = this.sshService.getStatusCommands(
      getDistroAndVersion,
      sshConfig.host,
      webView.web_port
    );

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = result[result.length - 1]?.output?.trim();

      const status = Number(lastOutput ?? 0);

      if (status === 200) {
        return true;
      }
    }

    return false;
  }

  private async imageIsBuilt(
    serverId: string,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    attempts = 20
  ): Promise<boolean> {
    const getImagesCommands =
      this.sshService.getImagesCommands(getDistroAndVersion);

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        getImagesCommands
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = result[result.length - 1]?.output?.trim();
      const status = Boolean(lastOutput ?? false);

      if (status) {
        return true;
      }
    }

    return false;
  }

  async execute(server: FastifyInstance): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaServiceQueueService.createServer()
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (message) => {
      const data = message.value as CreateServerResponse;

      if (!data) {
        throw new Error('Received message without value');
      }

      let serverId: string | null = null;

      try {
        serverId = data.server_id;
        if (!serverId) {
          throw new Error('Server ID is not defined in the message');
        }

        const { getDistroAndVersion, sshConfig, webView } =
          await this.validate(serverId);

        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.installing
        );

        const installCommands = await this.sshService.getInstallCommands(
          getDistroAndVersion,
          webView
        );

        const logs = await this.sshService.runCommands(
          serverId,
          sshConfig,
          installCommands
        );

        const imageIsBuilt = await this.imageIsBuilt(
          serverId,
          getDistroAndVersion,
          sshConfig
        );

        if (!imageIsBuilt) {
          await this.serverService.updateServerStatusById(
            serverId,
            EServerStatus.error
          );

          throw new Error('Docker image is not built');
        }

        await this.serverService.deleteLogInstallServer(serverId);
        await this.serverService.updateLogInstallServerBulk(logs);

        const installed = await this.isInstalled(
          serverId,
          getDistroAndVersion,
          sshConfig,
          webView
        );

        const finalStatus = installed
          ? EServerStatus.online
          : EServerStatus.error;

        await this.serverService.updateServerStatusById(serverId, finalStatus);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        server.logger.warn(`Skipping server ${serverId ?? 'unknown'}: ${msg}`);

        if (serverId) {
          await this.serverService.updateServerStatusById(
            serverId,
            EServerStatus.error
          );
        }
      }
    });

    try {
      await stream.start();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      server.logger.error(`Error starting stream: ${msg}`);
    }
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
