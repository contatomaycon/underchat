import { container } from 'tsyringe';
import { BaileysConnectionConsume } from '@core/consumer/baileys/BaileysConnection.consume';
import { FastifyInstance } from 'fastify';

export default async function baileysConsume(server: FastifyInstance) {
  const baileysConnectionConsume = container.resolve(BaileysConnectionConsume);

  await baileysConnectionConsume.execute(server);
}
