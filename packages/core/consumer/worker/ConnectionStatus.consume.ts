import { injectable } from 'tsyringe';
import { FastifyInstance } from 'fastify';
import { ServerRabbitMQService } from '@core/services/serverRabbitMQ.service';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';

@injectable()
export class ConnectionStatusConsume {
  constructor(
    private readonly serverRabbitMQService: ServerRabbitMQService,
    private readonly baileysService: BaileysService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    await this.serverRabbitMQService.receive(
      `worker:${baileysEnvironment.baileysWorkerId}:status`,
      async (content) => {
        let workerId: string | null = null;
        let status: EWorkerStatus | null = null;

        try {
          if (!content) {
            throw new Error('Received message without value');
          }

          const raw =
            content instanceof Buffer
              ? content.toString('utf8')
              : String(content);

          const data = JSON.parse(raw) as StatusConnectionWorkerRequest;

          workerId = data.worker_id;

          console.log('workerId:', workerId);

          if (!workerId) {
            throw new Error('Worker ID is not defined in the message');
          }

          status = data.status as EWorkerStatus;

          console.log('status:', status);

          if (!status) {
            throw new Error('Status is not defined in the message');
          }

          if (status === EWorkerStatus.online) {
            try {
              await this.baileysService.connect();
            } catch (err) {
              console.error('Erro ao conectar com o WhatsApp:', err);
            }
          }

          if (status === EWorkerStatus.offline) {
          }

          if (status === EWorkerStatus.disponible) {
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);

          server.logger.warn(`Skipping message due to error: ${msg}`);
        }
      }
    );
  }
}
