import fp from 'fastify-plugin';
import { Pool } from 'pg';
import { databaseEnvironment } from '@core/config/environments';
import DatabaseConnectionError from '@core/common/exceptions/DatabaseConnectionError';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@core/models';
import { container } from 'tsyringe';
import { FastifyInstance } from 'fastify';

async function dbConnector(fastify: FastifyInstance) {
  const poolRw = new Pool({
    host: databaseEnvironment.dbHostRw,
    port: databaseEnvironment.dbPortRw,
    user: databaseEnvironment.dbUser,
    password: databaseEnvironment.dbPassword,
    database: databaseEnvironment.dbDatabase,
  });

  const poolRo = new Pool({
    host: databaseEnvironment.dbHostRo,
    port: databaseEnvironment.dbPortRo,
    user: databaseEnvironment.dbUser,
    password: databaseEnvironment.dbPassword,
    database: databaseEnvironment.dbDatabase,
  });

  if (databaseEnvironment.dbSslMode) {
    poolRw.options.ssl = {
      rejectUnauthorized: false,
    };
    poolRo.options.ssl = {
      rejectUnauthorized: false,
    };
  }

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
}

export default fp(dbConnector, { name: 'db-connector' });
