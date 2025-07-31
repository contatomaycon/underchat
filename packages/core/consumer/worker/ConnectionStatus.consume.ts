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
      async (content) => {
        let data: StatusConnectionWorkerRequest;
        try {
          const raw =
            content instanceof Buffer
              ? content.toString('utf8')
              : String(content);
          data = JSON.parse(raw) as StatusConnectionWorkerRequest;
        } catch {
          return;
        }

        if (data.status === EWorkerStatus.online) {
          await this.baileysService.connect(true);

          return;
        }

        if (data.status === EWorkerStatus.disponible) {
          this.baileysService.disconnect(true);

          return;
        }
      }
    );
  }
}
