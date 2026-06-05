import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeConsume } from '@core/consumer/worker/WorkerConnectionQrCode.consume';

export function startConnectionQrCodeConsume(
  server: FastifyInstance
): WorkerConnectionQrCodeConsume {
  const connectionQrCodeConsume = container.resolve(
    WorkerConnectionQrCodeConsume
  );

  connectionQrCodeConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting connection QR consume');
  });

  return connectionQrCodeConsume;
}
