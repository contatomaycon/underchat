import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';
import { Kafka } from 'kafkajs';

interface KafkaPluginOptions {
  module: ERouteModule;
}

const kafkaPlugin: FastifyPluginAsync<KafkaPluginOptions> = async (
  fastify: FastifyInstance,
  opts
) => {
  const module = opts.module;

  const kafka = new Kafka({
    clientId: `client-${module}`,
    brokers: [kafkaEnvironment.kafkaBroker],
    retry: { initialRetryTime: 300, retries: 8 },
  });

  container.register<Kafka>('Kafka', { useValue: kafka });

  fastify.decorate('kafka', kafka);
};

export default fp(kafkaPlugin, { name: 'kafka-plugin' });
