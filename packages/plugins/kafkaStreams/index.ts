import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';
import {
  KafkaConsumer,
  Producer,
  ConsumerGlobalConfig,
  ConsumerTopicConfig,
} from 'node-rdkafka';

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
    const baseConfig: ConsumerGlobalConfig = {
      'group.id': groupId,
      'metadata.broker.list': this.broker,
      'enable.auto.commit': false,
      'session.timeout.ms': 60000,
      'heartbeat.interval.ms': 10000,
      'socket.timeout.ms': 30000,
      'socket.keepalive.enable': true,
      'api.version.request': true,
      'api.version.request.timeout.ms': 10000,
      'metadata.max.age.ms': 300000,
    };

    const consumerConfig: ConsumerGlobalConfig = {
      ...baseConfig,
      'group.id': groupId,
      'metadata.broker.list': this.broker,
    };

    const opicConf: ConsumerTopicConfig = {
      'auto.offset.reset': 'earliest',
    };

    return new KafkaConsumer(consumerConfig, opicConf);
  }

  createProducer(): Producer {
    return new Producer(
      {
        'metadata.broker.list': this.broker,
        'client.id': this.clientId,
        'retry.backoff.ms': 300,
        'message.send.max.retries': 8,
        'socket.timeout.ms': 10000,
        'socket.keepalive.enable': true,
        'api.version.request': true,
        'api.version.request.timeout.ms': 10000,
        'metadata.max.age.ms': 300000,
        'socket.connection.setup.timeout.ms': 10000,
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
