import { databaseElasticEnvironment } from '@core/config/environments';
import { Client } from '@elastic/elasticsearch';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

const databaseElasticPlugin = async (fastify: FastifyInstance) => {
  const startTs = Date.now();
  fastify.log.info(
    { ts: startTs, host: databaseElasticEnvironment.elasticSearchHost },
    'Elastic plugin inicializando'
  );
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

    // Retry - recuperação rápida de falhas transientes
    maxRetries: 3,

    // Timeout - adequado para operações de chat
    requestTimeout: 30000,

    // Compressão - reduz bandwidth e melhora throughput
    compression: true,

    // Resurrect - estratégia otimista para recuperar nós mais rápido
    resurrectStrategy: 'optimistic',
  });

  container.register<Client>('DatabaseElasticClient', {
    useValue: client,
  });

  fastify.decorate('DatabaseElasticClient', client);

  // Evita travar a inicialização: ping em segundo plano
  void (async () => {
    try {
      const pingStart = Date.now();
      await client.ping();
      fastify.log.info(
        { ms: Date.now() - pingStart, ts: Date.now() },
        'Elastic ping concluido'
      );
      fastify.log.info(
        { ms: Date.now() - startTs, ts: Date.now() },
        'Elastic plugin pronto'
      );
    } catch (error) {
      fastify.log.error(
        {
          ms: Date.now() - startTs,
          ts: Date.now(),
          err: error instanceof Error ? error.message : String(error),
        },
        'Elastic plugin falhou ao conectar'
      );
    }
  })();
};

export default fp(databaseElasticPlugin, { name: 'database-elastic-plugin' });
