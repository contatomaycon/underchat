import { databaseEnvironment } from '@core/config/environments';
import * as schema from '@core/models';
import {
  buildWebhookDispatcherPoolConfig,
  verifyWebhookDispatcherDatabaseConnection,
} from '@core/services/webhookDispatcherPostgresPool';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { Pool } from 'pg';
import { container } from 'tsyringe';
import type { WebhookDispatcherRuntimeConfig } from '../config';

/**
 * Creates the dispatcher-only PostgreSQL plugin. The worker never reads from
 * the replica, so provisioning the shared RW and RO pools would double its
 * connection footprint without providing any benefit.
 */
export const createWebhookDispatcherDatabasePlugin = (
  config: WebhookDispatcherRuntimeConfig
): FastifyPluginAsync =>
  fastifyPlugin(
    async (server): Promise<void> => {
      const sslMode = databaseEnvironment.dbSslMode;
      const pool = new Pool(
        buildWebhookDispatcherPoolConfig(config, {
          host: databaseEnvironment.dbHostRw,
          port: databaseEnvironment.dbPortRw,
          user: databaseEnvironment.dbUser,
          password: databaseEnvironment.dbPassword,
          database: databaseEnvironment.dbDatabase,
          ssl:
            sslMode === 'disable'
              ? false
              : {
                  rejectUnauthorized:
                    sslMode === 'verify-ca' || sslMode === 'verify-full',
                },
        })
      );

      await verifyWebhookDispatcherDatabaseConnection(pool);
      const database: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

      pool.on('error', (error: Error) => {
        server.log.error(
          { err: error },
          'Unexpected idle PostgreSQL client error in webhook dispatcher'
        );
      });

      container.register<NodePgDatabase<typeof schema>>('DatabaseRw', {
        useValue: database,
      });
      container.register<Pool>('DatabasePoolRw', { useValue: pool });
      server.decorate('DatabaseRw', database);
      server.decorate('DatabasePoolRw', pool);

      server.addHook('onClose', async (): Promise<void> => {
        await pool.end();
      });
    },
    { name: 'webhook-dispatcher-database' }
  );
