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

  const TERMINATED_LOG_THROTTLE_MS = 30_000;
  const terminatedLogState = new Map<
    string,
    {
      lastLoggedAt: number;
      suppressedCount: number;
    }
  >();

  const serializeDatabaseError = (err: Error): Record<string, unknown> => {
    const normalizedError = err as NodeJS.ErrnoException;
    return {
      name: normalizedError.name,
      message: normalizedError.message,
      ...(normalizedError.code ? { code: normalizedError.code } : {}),
    };
  };

  const logTerminatedConnection = (
    pool: 'rw' | 'ro',
    type:
      | 'database_connection_terminated'
      | 'database_client_connection_terminated',
    message: string,
    err: Error
  ): void => {
    const key = `${pool}:${type}`;
    const now = Date.now();
    const previous = terminatedLogState.get(key);

    if (previous && now - previous.lastLoggedAt < TERMINATED_LOG_THROTTLE_MS) {
      terminatedLogState.set(key, {
        ...previous,
        suppressedCount: previous.suppressedCount + 1,
      });
      return;
    }

    const suppressedCount = previous?.suppressedCount ?? 0;
    terminatedLogState.set(key, {
      lastLoggedAt: now,
      suppressedCount: 0,
    });

    import('@core/plugins/telemetry/logger.js')
      .then(({ logger }) => {
        logger.warn(
          {
            err: serializeDatabaseError(err),
            type,
            pool,
            ...(suppressedCount > 0 ? { suppressedCount } : {}),
          },
          message
        );
      })
      .catch(() => {});
  };

  poolRw.on('error', (err) => {
    if (isConnectionTerminatedError(err)) {
      logTerminatedConnection(
        'rw',
        'database_connection_terminated',
        'Database connection terminated (RW)',
        err
      );
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
      import('@core/plugins/telemetry/observability.js')
        .then(({ recordException }) => {
          recordException(err, {
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
        logTerminatedConnection(
          'rw',
          'database_client_connection_terminated',
          'Database client connection terminated (RW)',
          err
        );
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
      logTerminatedConnection(
        'ro',
        'database_connection_terminated',
        'Database connection terminated (RO)',
        err
      );
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
      import('@core/plugins/telemetry/observability.js')
        .then(({ recordException }) => {
          recordException(err, {
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
        logTerminatedConnection(
          'ro',
          'database_client_connection_terminated',
          'Database client connection terminated (RO)',
          err
        );
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
  container.register<Pool>('DatabasePoolRw', {
    useValue: poolRw,
  });
  container.register<Pool>('DatabasePoolRo', {
    useValue: poolRo,
  });

  fastify.decorate('DatabaseRw', connectionRw);
  fastify.decorate('DatabaseRo', connectionRo);
  fastify.decorate('DatabasePoolRw', poolRw);
  fastify.decorate('DatabasePoolRo', poolRo);

  fastify.addHook('onClose', async () => {
    await Promise.allSettled([poolRw.end(), poolRo.end()]);
  });
}

export default fp(dbConnector, { name: 'db-connector' });
