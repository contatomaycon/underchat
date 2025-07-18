import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';

export default async function balanceConsume(server: FastifyInstance) {
  const balanceCreatorConsume = container.resolve(BalanceCreatorConsume);

  await balanceCreatorConsume.execute(server);
}
