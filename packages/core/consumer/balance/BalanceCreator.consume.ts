import { injectable } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { SshService } from '@core/services/ssh.service';
import { FastifyInstance } from 'fastify';
import { ETopicKafka } from '@core/common/enums/ETopicKafka';
import { ServerService } from '@core/services/server.service';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ConnectConfig } from 'ssh2';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { isDistroVersionAllowed } from '@core/common/functions/isDistroVersionAllowed';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';

@injectable()
export class BalanceCreatorConsume {
  constructor(
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private async validate(serverId: number): Promise<{
    getDistroAndVersion: IDistroInfo;
    sshConfig: ConnectConfig;
  }> {
    const viewServerSshById =
      await this.serverService.viewServerSshById(serverId);

    if (!viewServerSshById) {
      throw new Error('SSH configuration not found');
    }

    if (viewServerSshById.server_status_id !== EServerStatus.new) {
      throw new Error('Server is not in new status');
    }

    const sshConfig: ConnectConfig = {
      host: viewServerSshById.ssh_ip,
      port: viewServerSshById.ssh_port,
      username: this.passwordEncryptorService.decrypt(
        viewServerSshById.ssh_username
      ),
      password: this.passwordEncryptorService.decrypt(
        viewServerSshById.ssh_password
      ),
    };

    const isConnected = await this.sshService.testSSHConnection(sshConfig);

    if (!isConnected) {
      throw new Error('SSH connection failed');
    }

    const getDistroAndVersion =
      await this.sshService.getDistroAndVersion(sshConfig);

    if (!getDistroAndVersion) {
      throw new Error('Failed to retrieve distribution and version');
    }

    const isDistroVAllowed = isDistroVersionAllowed(getDistroAndVersion);

    if (!isDistroVAllowed) {
      throw new Error('Distribution and version not allowed');
    }

    return { getDistroAndVersion, sshConfig };
  }

  private async isInstalled(
    getDistroAndVersion: IDistroInfo,
    sshConfig: ConnectConfig
  ) {
    const commands = this.sshService.getStatus(getDistroAndVersion);
    const result = await this.sshService.runCommands(sshConfig, commands);

    console.dir(result, { depth: null });
  }

  async execute(fastify: FastifyInstance): Promise<void> {
    const consumer = fastify.kafka.consumer;
    consumer.subscribe({
      topic: ETopicKafka.balance_create,
      fromBeginning: false,
    });

    consumer
      .run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message, heartbeat }) => {
          if (!message.value) {
            throw new Error('Received message without value');
          }

          const data = JSON.parse(
            message.value.toString()
          ) as CreateServerResponse;
          const serverId = data.server_id;

          const { getDistroAndVersion, sshConfig } =
            await this.validate(serverId);

          const commands =
            await this.sshService.getInstallCommands(getDistroAndVersion);

          await this.sshService.runCommands(sshConfig, commands);

          const isInstalled = await this.isInstalled(
            getDistroAndVersion,
            sshConfig
          );

          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: (Number(message.offset) + 1).toString(),
            },
          ]);

          await heartbeat();
        },
      })
      .catch((err) => fastify.log.error('Error in consumer run:', err));
  }
}
