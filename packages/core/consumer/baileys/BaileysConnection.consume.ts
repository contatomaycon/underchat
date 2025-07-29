import { inject, injectable } from 'tsyringe';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';
import { ETopicKafka } from '@core/common/enums/ETopicKafka';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IKafkaMsg } from '@core/common/interfaces/IKafkaMsg';
import { FastifyInstance } from 'fastify';
import { BaileysService } from '@core/services/baileys';

@injectable()
export class BaileysConnectionConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly baileysService: BaileysService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      ETopicKafka.connection_channel
    );

    stream.mapBufferKeyToString();
    stream.mapBufferValueToString();

    stream.forEach(async (message: IKafkaMsg) => {
      let serverId: string | null = null;

      try {
        if (!message.value) {
          throw new Error('Received message without value');
        }

        const raw =
          message.value instanceof Buffer
            ? message.value.toString('utf8')
            : String(message.value);

        const data = JSON.parse(raw) as CreateServerResponse;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        server.logger.warn(`Skipping server ${serverId ?? 'unknown'}: ${msg}`);
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
