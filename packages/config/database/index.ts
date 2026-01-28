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
    keepAliveInitialDelayMillis: 5000,
    allowExitOnIdle: true,
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
    keepAliveInitialDelayMillis: 5000,
    allowExitOnIdle: true,
    ssl,
  });

  const isConnectionTerminatedError = (err: Error): boolean => {
    const message = err.message.toLowerCase();
    return (
      message.includes('connection terminated') ||
      message.includes('connection closed') ||
      message.includes('connection ended') ||
      message.includes('server closed the connection') ||
      message.includes('terminating connection due to') ||
      message.includes('terminated unexpectedly')
    );
  };

  poolRw.on('error', (err) => {
    if (isConnectionTerminatedError(err)) {
      import('@core/plugins/telemetry/logger.js')
        .then(({ logger }) => {
          logger.warn(
            {
              err,
              type: 'database_connection_terminated',
              pool: 'rw',
            },
            'Database connection terminated (RW)'
          );
        })
        .catch(() => {});
      return;
    }

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

    if (!isConnectionTerminatedError(err)) {
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
    }
  });

  poolRw.on('connect', (client) => {
    client.on('error', (err) => {
      if (isConnectionTerminatedError(err)) {
        import('@core/plugins/telemetry/logger.js')
          .then(({ logger }) => {
            logger.warn(
              {
                err,
                type: 'database_client_connection_terminated',
                pool: 'rw',
              },
              'Database client connection terminated (RW)'
            );
          })
          .catch(() => {});
        return;
      }
    });

    client.on('end', () => {
      import('@core/plugins/telemetry/logger.js')
        .then(({ logger }) => {
          logger.debug(
            {
              type: 'database_client_ended',
              pool: 'rw',
            },
            'Database client connection ended (RW)'
          );
        })
        .catch(() => {});
    });
  });

  poolRo.on('error', (err) => {
    if (isConnectionTerminatedError(err)) {
      import('@core/plugins/telemetry/logger.js')
        .then(({ logger }) => {
          logger.warn(
            {
              err,
              type: 'database_connection_terminated',
              pool: 'ro',
            },
            'Database connection terminated (RO)'
          );
        })
        .catch(() => {});
      return;
    }

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

    if (!isConnectionTerminatedError(err)) {
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
    }
  });

  poolRo.on('connect', (client) => {
    client.on('error', (err) => {
      if (isConnectionTerminatedError(err)) {
        import('@core/plugins/telemetry/logger.js')
          .then(({ logger }) => {
            logger.warn(
              {
                err,
                type: 'database_client_connection_terminated',
                pool: 'ro',
              },
              'Database client connection terminated (RO)'
            );
          })
          .catch(() => {});
        return;
      }
    });

    client.on('end', () => {
      import('@core/plugins/telemetry/logger.js')
        .then(({ logger }) => {
          logger.debug(
            {
              type: 'database_client_ended',
              pool: 'ro',
            },
            'Database client connection ended (RO)'
          );
        })
        .catch(() => {});
    });
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
