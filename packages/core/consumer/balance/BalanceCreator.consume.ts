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

@injectable()
export class BalanceCreatorConsume {
  constructor(
    private readonly sshService: SshService,
    private readonly serverService: ServerService,
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

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
            fastify.logger.error('Received message without value');

            return;
          }

          const data = JSON.parse(
            message.value.toString()
          ) as CreateServerResponse;
          const serverId = data.server_id;

          const viewServerSshById =
            await this.serverService.viewServerSshById(serverId);

          if (!viewServerSshById) {
            fastify.logger.error(
              `No SSH configuration found for server ID: ${serverId}`
            );

            return;
          }

          if (viewServerSshById.server_status_id !== EServerStatus.new) {
            fastify.logger.info(
              `Server ID ${serverId} is not in 'new' status, skipping balance creation`
            );

            return;
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

          const isConnected =
            await this.sshService.testSSHConnection(sshConfig);

          if (!isConnected) {
            fastify.logger.error(
              `SSH connection failed for server ID: ${serverId}`
            );

            return;
          }

          const getDistroAndVersion =
            await this.sshService.getDistroAndVersion(sshConfig);

          if (!getDistroAndVersion) {
            fastify.logger.error(
              `Failed to retrieve distribution and version for server ID: ${serverId}`
            );

            return;
          }

          const isDistroVAllowed = isDistroVersionAllowed(getDistroAndVersion);

          if (!isDistroVAllowed) {
            fastify.logger.error(
              `Distribution and version not allowed for server ID: ${serverId}`
            );

            return;
          }

          const commands =
            await this.sshService.getInstallCommands(getDistroAndVersion);

          const results = await this.sshService.runCommands(
            sshConfig,
            commands
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
