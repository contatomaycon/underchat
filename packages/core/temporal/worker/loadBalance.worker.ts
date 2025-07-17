import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as loadBalanceQueueActivity from '@core/temporal/activities/loadBalance/queue.activity';
import { temporalEnvironment } from '@core/config/environments';

export const loadBalanceWorker = async (fastify: FastifyInstance) => {
  const [loadBalanceQueue] = await Promise.all([
    Worker.create({
      connection: fastify.temporal.nativeConnection,
      workflowsPath: require.resolve(
        '@core/temporal/workflows/loadBalance/index.workflow'
      ),
      activities: loadBalanceQueueActivity,
      taskQueue: 'load-balance-queue',
      namespace: temporalEnvironment.getTemporalNamespace(),
    }),
  ]);

  await Promise.all([
    loadBalanceQueue.run().catch((err) => {
      fastify.log.error('Erro ao executar o Worker:', err);
    }),
  ]);
};
