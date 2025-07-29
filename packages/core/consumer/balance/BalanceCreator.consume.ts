import { injectable } from 'tsyringe';
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
import { ServerRabbitMQService } from '@core/services/serverRabbitMQ.service';

@injectable()
export class BalanceCreatorConsume {
  constructor(
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    private readonly serverRabbitMQService: ServerRabbitMQService
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
    attempts = 10
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
      await new Promise((r) => setTimeout(r, 6000));

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands
      );

      if (result.length > 0) {
        await this.serverService.updateLogInstallServerBulk(result);
      }

      const lastOutput = result[result.length - 1]?.output?.trim();

      const status = parseInt(lastOutput ?? '0', 10);

      if (status === 200) {
        return true;
      }
    }

    return false;
  }

  async execute(server: FastifyInstance): Promise<void> {
    await this.serverRabbitMQService.receive(
      'create:server',
      async (content) => {
        let serverId: string | null = null;

        try {
          if (!content) {
            throw new Error('Received message without value');
          }

          const raw =
            content instanceof Buffer
              ? content.toString('utf8')
              : String(content);

          const data = JSON.parse(raw) as CreateServerResponse;

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

          const getImagesCommands =
            this.sshService.getImagesCommands(getDistroAndVersion);

          const imagesLogs = await this.sshService.runCommands(
            serverId,
            sshConfig,
            getImagesCommands
          );

          console.log('imagesLogs:', imagesLogs);

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

          await this.serverService.updateServerStatusById(
            serverId,
            finalStatus
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);

          server.logger.warn(
            `Skipping server ${serverId ?? 'unknown'}: ${msg}`
          );

          if (serverId) {
            await this.serverService.updateServerStatusById(
              serverId,
              EServerStatus.error
            );
          }
        }
      }
    );
  }
}
