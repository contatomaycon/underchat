import { container } from 'tsyringe';
import { ConnectionStatusConsume } from '@core/consumer/worker/ConnectionStatus.consume';
import { FastifyInstance } from 'fastify';

export default async function connectionConsume(server: FastifyInstance) {
  const connectionStatusConsume = container.resolve(ConnectionStatusConsume);

  await connectionStatusConsume.execute(server);
}
