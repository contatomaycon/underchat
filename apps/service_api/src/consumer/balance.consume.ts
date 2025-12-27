import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';

export function startBalanceConsume(
  server: FastifyInstance
): BalanceCreatorConsume {
  const balanceCreatorConsume = container.resolve(BalanceCreatorConsume);

  balanceCreatorConsume.execute(server).catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting balance creator consume');
  });

  return balanceCreatorConsume;
}
