import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeWwebjsConsume } from '@core/consumer/worker/WorkerConnectionQrCodeWwebjs.consume';

export function startConnectionQrCodeWwebjsConsume(
  server: FastifyInstance
): WorkerConnectionQrCodeWwebjsConsume {
  const connectionQrCodeConsume = container.resolve(
    WorkerConnectionQrCodeWwebjsConsume
  );

  connectionQrCodeConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting connection QR consume');
  });

  return connectionQrCodeConsume;
}
