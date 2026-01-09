import fp from 'fastify-plugin';
import { Pool } from 'pg';
import { databaseEnvironment } from '@core/config/environments';
import DatabaseConnectionError from '@core/common/exceptions/DatabaseConnectionError';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@core/models';
import { container } from 'tsyringe';
import { FastifyInstance } from 'fastify';

async function dbConnector(fastify: FastifyInstance) {
  const sslMode = databaseEnvironment.dbSslMode;
  const ssl =
    sslMode === 'disable'
      ? false
      : {
          rejectUnauthorized:
            sslMode === 'verify-ca' || sslMode === 'verify-full',
        };

  const poolRw = new Pool({
    host: databaseEnvironment.dbHostRw,
    port: databaseEnvironment.dbPortRw,
    user: databaseEnvironment.dbUser,
    password: databaseEnvironment.dbPassword,
    database: databaseEnvironment.dbDatabase,
    min: databaseEnvironment.dbPoolMin,
    max: databaseEnvironment.dbPoolMax,
    idleTimeoutMillis: databaseEnvironment.dbPoolIdleTimeout,
    connectionTimeoutMillis: databaseEnvironment.dbPoolAcquireTimeout,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl,
  });

  const poolRo = new Pool({
    host: databaseEnvironment.dbHostRo,
    port: databaseEnvironment.dbPortRo,
    user: databaseEnvironment.dbUser,
    password: databaseEnvironment.dbPassword,
    database: databaseEnvironment.dbDatabase,
    min: databaseEnvironment.dbPoolMin,
    max: databaseEnvironment.dbPoolMax,
    idleTimeoutMillis: databaseEnvironment.dbPoolIdleTimeout,
    connectionTimeoutMillis: databaseEnvironment.dbPoolAcquireTimeout,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ssl,
  });

  poolRw.on('error', (err) => {
    import('@core/plugins/telemetry/logger.js')
      .then(({ logger }) => {
        logger.error(
          {
            err,
            type: 'database_pool_error',
            pool: 'rw',
          },
          'Unexpected error on idle database client (RW)'
        );
      })
      .catch(() => {});

    import('@core/plugins/telemetry/sentry.js')
      .then(({ captureException }) => {
        captureException(err, {
          database: {
            pool: 'rw',
            type: 'pool_error',
          },
        });
      })
      .catch(() => {});
  });

  poolRo.on('error', (err) => {
    import('@core/plugins/telemetry/logger.js')
      .then(({ logger }) => {
        logger.error(
          {
            err,
            type: 'database_pool_error',
            pool: 'ro',
          },
          'Unexpected error on idle database client (RO)'
        );
      })
      .catch(() => {});

    import('@core/plugins/telemetry/sentry.js')
      .then(({ captureException }) => {
        captureException(err, {
          database: {
            pool: 'ro',
            type: 'pool_error',
          },
        });
      })
      .catch(() => {});
  });

  const connectionRw = drizzle(poolRw, { schema });
  const connectionRo = drizzle(poolRo, { schema });

  if (!connectionRw) {
    throw new DatabaseConnectionError(
      'Não foi possível conectar ao banco de dados'
    );
  }

  if (!connectionRo) {
    throw new DatabaseConnectionError(
      'Não foi possível conectar ao banco de dados'
    );
  }

  container.register<NodePgDatabase<typeof schema>>('DatabaseRw', {
    useValue: connectionRw,
  });
  container.register<NodePgDatabase<typeof schema>>('DatabaseRo', {
    useValue: connectionRo,
  });

  fastify.decorate('DatabaseRw', connectionRw);
  fastify.decorate('DatabaseRo', connectionRo);

  fastify.addHook('onClose', async () => {
    await Promise.allSettled([poolRw.end(), poolRo.end()]);
  });
}

export default fp(dbConnector, { name: 'db-connector' });
