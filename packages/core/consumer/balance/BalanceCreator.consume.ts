import { inject, injectable } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { SshService } from '@core/services/ssh.service';
import { ETopicKafka } from '@core/common/enums/ETopicKafka';
import { ServerService } from '@core/services/server.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ConnectConfig } from 'ssh2';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IKafkaMsg } from '@core/common/interfaces/IKafkaMsg';
import { FastifyInstance } from 'fastify';

@injectable()
export class BalanceCreatorConsume {
  constructor(
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams
  ) {}

  private async validate(serverId: number): Promise<{
    getDistroAndVersion: IDistroInfo;
    sshConfig: ConnectConfig;
  }> {
    const view = await this.serverService.viewServerSshById(serverId);

    if (!view) {
      throw new Error('SSH configuration not found');
    }

    if (view.server_status_id !== EServerStatus.new) {
      throw new Error('Server is not in new status');
    }

    const sshConfig: ConnectConfig = {
      host: view.ssh_ip,
      port: view.ssh_port,
      username: this.passwordEncryptorService.decrypt(view.ssh_username),
      password: this.passwordEncryptorService.decrypt(view.ssh_password),
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

    return { getDistroAndVersion: distro, sshConfig };
  }

  private async isInstalled(
    serverId: number,
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig,
    attempts = 10
  ): Promise<boolean> {
    if (!sshConfig.host) {
      throw new Error('SSH host is not defined');
    }

    const commands = this.sshService.getStatusCommands(
      getDistroAndVersion,
      sshConfig.host,
      3003
    );

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 6000));

      const result = await this.sshService.runCommands(
        serverId,
        sshConfig,
        commands
      );

      if (result.length > 0) {
        this.serverService.updateLogInstallServerBulk(result);
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
    const stream: KStream = this.kafkaStreams.getKStream(
      ETopicKafka.balance_create
    );

    stream.mapBufferKeyToString();
    stream.mapBufferValueToString();

    stream.forEach(async (message: IKafkaMsg) => {
      let serverId: number = 0;

      try {
        if (!message.value) {
          throw new Error('Received message without value');
        }

        const raw =
          message.value instanceof Buffer
            ? message.value.toString('utf8')
            : String(message.value);

        const data = JSON.parse(raw) as CreateServerResponse;
        serverId = data.server_id;

        if (!serverId) {
          throw new Error('Server ID is not defined in the message');
        }

        const { getDistroAndVersion, sshConfig } =
          await this.validate(serverId);

        await this.serverService.updateServerStatusById(
          serverId,
          EServerStatus.installing
        );

        const installCommands =
          await this.sshService.getInstallCommands(getDistroAndVersion);

        const logs = await this.sshService.runCommands(
          serverId,
          sshConfig,
          installCommands
        );

        this.serverService.updateLogInstallServerBulk(logs);

        const installed = await this.isInstalled(
          serverId,
          getDistroAndVersion,
          sshConfig
        );

        const finalStatus = installed
          ? EServerStatus.online
          : EServerStatus.error;

        await this.serverService.updateServerStatusById(serverId, finalStatus);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        server.logger.warn(`Skipping server ${serverId ?? 'unknown'}: ${msg}`);

        if (serverId > 0) {
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
}
