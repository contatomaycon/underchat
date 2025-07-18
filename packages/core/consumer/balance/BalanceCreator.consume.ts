import { injectable } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { SshService } from '@core/services/ssh.service';
import { FastifyInstance } from 'fastify';
import { ETopicKafka } from '@core/common/enums/ETopicKafka';

@injectable()
export class BalanceCreatorConsume {
  constructor(private readonly sshService: SshService) {}

  async execute(fastify: FastifyInstance): Promise<void> {
    const consumer = fastify.kafka.consumer;
    console.log(`Received message on topic: aquiring balance creation`);

    consumer.subscribe({
      topic: ETopicKafka.balance_create,
      fromBeginning: true,
    });

    consumer
      .run({
        autoCommit: true,
        eachMessage: async ({ topic, message, heartbeat }) => {
          console.log(`Received message on topic: ${topic}`);

          if (topic !== ETopicKafka.balance_create) {
            return;
          }

          if (!message.value) {
            fastify.logger.error('Received message without value');

            return;
          }

          const data = JSON.parse(
            message.value.toString()
          ) as CreateServerResponse;
          const serverId = data.server_id;

          console.log(`Processing balance creation for server ID: ${serverId}`);

          await heartbeat();
        },
      })
      .catch((err) => fastify.log.error('Error in consumer run:', err));
  }
}
