import { elasticSearchEnvironment } from '@core/config/environments';
import { Client } from '@elastic/elasticsearch';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

const elasticLogsPlugin = async (fastify: FastifyInstance) => {
  const client = new Client({
    node: elasticSearchEnvironment.elasticSearchHost,
    auth: {
      username: elasticSearchEnvironment.elasticSearchUser,
      password: elasticSearchEnvironment.elasticSearchPassword,
    },
    headers: {
      accept: 'application/vnd.elasticsearch+json;',
      'content-type': 'application/vnd.elasticsearch+json;',
    },
  });

  try {
    await client.ping();

    container.register<Client>('ElasticLogsClient', {
      useValue: client,
    });

    fastify.decorate('ElasticLogsClient', client);
  } catch {
    throw new Error(`Failed to connect to ElasticLogs`);
  }
};

export default fp(elasticLogsPlugin, { name: 'elastic-logs-plugin' });
