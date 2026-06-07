import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeConsume } from '@core/consumer/worker/WorkerConnectionQrCode.consume';

export function startConnectionQrCodeConsume(
  server: FastifyInstance
): Promise<WorkerConnectionQrCodeConsume> {
  const connectionQrCodeConsume = container.resolve(
    WorkerConnectionQrCodeConsume
  );

  return connectionQrCodeConsume
    .execute()
    .then(() => connectionQrCodeConsume)
    .catch((error: unknown) => {
      server.log.error({ err: error }, 'Error starting connection QR consume');
      throw error;
    });
}
