import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const balanceCreatorConsume = container.resolve(BalanceCreatorConsume);

    balanceCreatorConsume.execute(fastify).catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await balanceCreatorConsume.close();
    });
  },
  { name: 'balance-creator-consume' }
);
