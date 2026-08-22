import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startBalanceConsume(
  server: FastifyInstance
): BalanceCreatorConsume {
  const balanceCreatorConsume = container.resolve(BalanceCreatorConsume);

  return launchServiceApiConsumerStartup(
    balanceCreatorConsume,
    () => balanceCreatorConsume.execute(server),
    (error) =>
      server.log.error({ err: error }, 'Error starting balance creator consume')
  );
}
