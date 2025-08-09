import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { connectionTemporal } from './connection';
import { ITemporal } from '@core/common/interfaces/ITemporal';
import { nativeConnectionTemporal } from './nativeConnection';
import { clientTemporal } from './client';
import { container } from 'tsyringe';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';

const temporalPlugin = async (fastify: FastifyInstance) => {
  try {
    const [connection, nativeConnection, client] = await Promise.all([
      connectionTemporal(),
      nativeConnectionTemporal(),
      clientTemporal(),
    ]);

    fastify.decorate<ITemporal>('temporal', {
      connection,
      nativeConnection,
      client,
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
      await connection.close();
      await nativeConnection.close();

      fastify.log.info('Connection to Temporal closed successfully.');
    });
  } catch (err) {
    fastify.log.error('Error connecting to Temporal:', err);

    throw err;
  }
};

export default fp(temporalPlugin, { name: 'temporal-plugin' });
