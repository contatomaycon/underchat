import fp from 'fastify-plugin';
import { Pool } from 'pg';
import { databaseEnvironment } from '@core/config/environments';
import DatabaseConnectionError from '@core/common/exceptions/DatabaseConnectionError';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@core/models';
import { container } from 'tsyringe';
import { FastifyInstance } from 'fastify';

async function dbConnector(fastify: FastifyInstance) {
  const pool = new Pool({
    host: databaseEnvironment.dbHost,
    port: databaseEnvironment.dbPort,
    user: databaseEnvironment.dbUser,
    password: databaseEnvironment.dbPassword,
    database: databaseEnvironment.dbDatabase,
  });

  if (databaseEnvironment.dbSslMode) {
    pool.options.ssl = {
      rejectUnauthorized: false,
    };
  }

  const connection = drizzle(pool, { schema });

  if (!connection) {
    throw new DatabaseConnectionError(
      'Não foi possível conectar ao banco de dados'
    );
  }

  container.register<NodePgDatabase<typeof schema>>('Database', {
    useValue: connection,
  });

  fastify.decorate('Database', connection);
}

export default fp(dbConnector, { name: 'db-connector' });
