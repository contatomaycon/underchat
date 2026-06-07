import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeWwebjsConsume } from '@core/consumer/worker/WorkerConnectionQrCodeWwebjs.consume';

export function startConnectionQrCodeWwebjsConsume(
  server: FastifyInstance
): Promise<WorkerConnectionQrCodeWwebjsConsume> {
  const connectionQrCodeConsume = container.resolve(
    WorkerConnectionQrCodeWwebjsConsume
  );

  return connectionQrCodeConsume
    .execute()
    .then(() => connectionQrCodeConsume)
    .catch((error: unknown) => {
      server.log.error({ err: error }, 'Error starting connection QR consume');
      throw error;
    });
}
