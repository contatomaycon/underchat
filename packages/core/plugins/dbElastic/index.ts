import { databaseElasticEnvironment } from '@core/config/environments';
import { Client } from '@elastic/elasticsearch';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

const databaseElasticPlugin = async (fastify: FastifyInstance) => {
  const client = new Client({
    node: databaseElasticEnvironment.elasticSearchHost,
    auth: {
      username: databaseElasticEnvironment.elasticSearchUser,
      password: databaseElasticEnvironment.elasticSearchPassword,
    },
    headers: {
      accept: 'application/vnd.elasticsearch+json;',
      'content-type': 'application/vnd.elasticsearch+json;',
    },
  });

  try {
    await client.ping();

    container.register<Client>('DatabaseElasticClient', {
      useValue: client,
    });

    fastify.decorate('DatabaseElasticClient', client);
  } catch {
    throw new Error(`Failed to connect to DatabaseElastic`);
  }
};

export default fp(databaseElasticPlugin, { name: 'database-elastic-plugin' });
