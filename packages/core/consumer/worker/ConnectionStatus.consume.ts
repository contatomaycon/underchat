import { injectable } from 'tsyringe';
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

  async execute(): Promise<void> {
    await this.serverRabbitMQService.receive(
      `worker:${baileysEnvironment.baileysWorkerId}:status`,
      async (content, msg, channel) => {
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
          if (!workerId) {
            throw new Error('Worker ID is not defined in the message');
          }

          status = data.status as EWorkerStatus;
          if (!status) {
            throw new Error('Status is not defined in the message');
          }

          if (status === EWorkerStatus.online) {
            await this.baileysService.connect(true);

            return;
          }

          if (status === EWorkerStatus.disponible) {
            this.baileysService.disconnect(true);

            return;
          }
        } catch (err: unknown) {
          console.error(
            `Error processing connection status for worker ${workerId}:`,
            err
          );

          return;
        }

        channel.ack(msg);
      }
    );
  }
}
