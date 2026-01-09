import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { connectionTemporal } from './connection';
import { ITemporal } from '@core/common/interfaces/ITemporal';
import { nativeConnectionTemporal } from './nativeConnection';
import { clientTemporal } from './client';
import { container } from 'tsyringe';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';

const temporalPlugin = async (fastify: FastifyInstance) => {
  const [connection, nativeConnection, client] = await Promise.all([
    connectionTemporal(),
    nativeConnectionTemporal(),
    clientTemporal(),
  ]);

  const workers: Worker[] = [];

  fastify.decorate<ITemporal>('temporal', {
    connection,
    nativeConnection,
    client,
    registerWorker: (worker: Worker) => {
      workers.push(worker);
    },
  });

  container.register<Connection>('TemporalConnection', {
    useValue: connection,
  });

  container.register<NativeConnection>('TemporalNativeConnection', {
    useValue: nativeConnection,
  });

  container.register<Client>('TemporalClient', {
    useValue: client,
  });

  fastify.addHook('onClose', async () => {
    for (const worker of workers) {
      try {
        await worker.shutdown();
        fastify.log.info('Temporal worker stopped successfully.');
      } catch (err) {
        fastify.log.error(err, 'Error stopping Temporal worker.');
      }
    }

    await connection.close();
    await nativeConnection.close();

    fastify.log.info('Connection to Temporal closed successfully.');
  });
};

export default fp(temporalPlugin, { name: 'temporal-plugin' });
