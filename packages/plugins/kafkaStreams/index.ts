import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';
import { KafkaConsumer, Producer } from 'node-rdkafka';

export interface KafkaClient {
  createConsumer: (groupId: string) => KafkaConsumer;
  createProducer: () => Producer;
  getBroker: () => string;
}

class KafkaStreamsClient implements KafkaClient {
  private readonly broker: string;
  private readonly clientId: string;

  constructor(broker: string, clientId: string) {
    this.broker = broker;
    this.clientId = clientId;
  }

  getBroker(): string {
    return this.broker;
  }

  createConsumer(groupId: string): KafkaConsumer {
    return new KafkaConsumer(
      {
        'group.id': groupId,
        'metadata.broker.list': this.broker,
        'enable.auto.commit': false,
        'session.timeout.ms': 60000,
        'heartbeat.interval.ms': 10000,
      },
      {}
    );
  }

  createProducer(): Producer {
    return new Producer(
      {
        'metadata.broker.list': this.broker,
        'client.id': this.clientId,
        'retry.backoff.ms': 300,
        'message.send.max.retries': 8,
        dr_cb: true,
      },
      {}
    );
  }
}

interface KafkaPluginOptions {
  module: ERouteModule;
}

const kafkaPlugin: FastifyPluginAsync<KafkaPluginOptions> = async (
  fastify: FastifyInstance,
  opts
) => {
  const module = opts.module;

  const kafka = new KafkaStreamsClient(
    kafkaEnvironment.kafkaBroker,
    `client-${module}`
  );

  container.register('Kafka', { useValue: kafka });

  fastify.decorate('kafka', kafka);
};

export default fp(kafkaPlugin, { name: 'kafka-plugin' });
