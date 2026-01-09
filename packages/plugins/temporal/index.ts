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
    if (workers.length === 0) {
      fastify.log.info('No Temporal workers to shutdown.');
      await connection.close();
      await nativeConnection.close();
      fastify.log.info('Connection to Temporal closed successfully.');
      return;
    }

    for (let i = 0; i < workers.length; i++) {
      const worker = workers[i];
      try {
        fastify.log.info(
          `Shutting down Temporal worker ${i + 1}/${workers.length}...`
        );
        worker.shutdown();
        fastify.log.info(
          `Temporal worker ${i + 1}/${workers.length} stopped successfully.`
        );
      } catch (err) {
        fastify.log.error(
          err,
          `Error stopping Temporal worker ${i + 1}/${workers.length}.`
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      await connection.close();
      fastify.log.info('Temporal Connection closed successfully.');
    } catch (err) {
      fastify.log.error(err, 'Error closing Temporal Connection.');
    }

    try {
      await nativeConnection.close();
      fastify.log.info('Temporal NativeConnection closed successfully.');
    } catch (err) {
      fastify.log.error(err, 'Error closing Temporal NativeConnection.');
    }
  });
};

export default fp(temporalPlugin, { name: 'temporal-plugin' });
