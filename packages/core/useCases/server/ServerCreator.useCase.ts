import { injectable } from 'tsyringe';
import { ServerService } from '@core/services/server.service';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { TFunction } from 'i18next';
import { SshService } from '@core/services/ssh.service';
import { FastifyInstance } from 'fastify';
import { ETopicKafka } from '@core/common/enums/ETopicKafka';

@injectable()
export class ServerCreatorUseCase {
  constructor(
    private readonly serverService: ServerService,
    private readonly sshService: SshService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: CreateServerRequest
  ): Promise<void> {
    const serverExists = await this.serverService.viewByIp(input.ssh_ip);

    if (serverExists) {
      throw new Error(t('server_already_exists'));
    }

    const isConnected = await this.sshService.testSSHConnection({
      host: input.ssh_ip,
      port: input.ssh_port,
      username: input.ssh_username,
      password: input.ssh_password,
    });

    if (!isConnected) {
      throw new Error(t('ssh_connection_failed'));
    }
  }

  async onServerCreatedInKafka(
    fastify: FastifyInstance,
    t: TFunction<'translation', undefined>,
    serverId: number
  ): Promise<void> {
    try {
      const payload: CreateServerResponse = {
        server_id: serverId,
      };

      await fastify.kafka.producer.send({
        topic: ETopicKafka.balance_create,
        messages: [
          {
            value: JSON.stringify(payload),
          },
        ],
      });
    } catch {
      throw new Error(t('kafka_producer_error'));
    }
  }

  async execute(
    fastify: FastifyInstance,
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

    await this.onServerCreatedInKafka(fastify, t, serverId);

    return {
      server_id: serverId,
    };
  }
}
