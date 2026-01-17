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
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly securityProtocol: string;
  private readonly saslMechanism: string | undefined;
  private readonly queueBufferingMaxMs: number;
  private readonly batchNumMessages: number;
  private readonly queueBufferingMaxMessages: number;
  private readonly queueBufferingMaxKbytes: number;

  constructor(
    broker: string,
    clientId: string,
    username: string | undefined,
    password: string | undefined,
    securityProtocol: string,
    saslMechanism: string | undefined,
    queueBufferingMaxMs: number,
    batchNumMessages: number,
    queueBufferingMaxMessages: number,
    queueBufferingMaxKbytes: number
  ) {
    this.broker = broker;
    this.clientId = clientId;
    this.username = username;
    this.password = password;
    this.securityProtocol = securityProtocol;
    this.saslMechanism = saslMechanism;
    this.queueBufferingMaxMs = queueBufferingMaxMs;
    this.batchNumMessages = batchNumMessages;
    this.queueBufferingMaxMessages = queueBufferingMaxMessages;
    this.queueBufferingMaxKbytes = queueBufferingMaxKbytes;
  }

  getBroker(): string {
    return this.broker;
  }

  private getSecurityConfig(): Record<string, string | boolean> {
    const protocol = this.securityProtocol.toLowerCase();

    const config: Record<string, string | boolean> = {
      'security.protocol': protocol,
    };

    if (
      protocol !== 'plaintext' &&
      this.saslMechanism &&
      this.username &&
      this.password
    ) {
      config['sasl.mechanism'] = this.saslMechanism;
      config['sasl.username'] = this.username;
      config['sasl.password'] = this.password;
    }

    if (protocol === 'sasl_ssl' || protocol === 'ssl') {
      config['enable.ssl.certificate.verification'] = false;
    }

    return config;
  }

  createConsumer(groupId: string): KafkaConsumer {
    const securityConfig = this.getSecurityConfig();

    const baseConfig: ConsumerGlobalConfig = {
      'group.id': groupId,
      'metadata.broker.list': this.broker,
      'enable.auto.commit': false,

      // Session e heartbeat - otimizado para detecção rápida de falhas
      'session.timeout.ms': 10000,
      'heartbeat.interval.ms': 3000,

      // Socket - otimizado para baixa latência
      'socket.timeout.ms': 10000,
      'socket.keepalive.enable': true,
      'socket.nagle.disable': true, // Desabilita Nagle para menor latência

      // API e metadata
      'api.version.request': true,
      'api.version.request.timeout.ms': 10000,
      'metadata.max.age.ms': 180000,

      // Fetch - otimizado para chat real-time (baixa latência)
      'fetch.wait.max.ms': 50, // Reduzido de 500ms para 50ms
      'fetch.message.max.bytes': 1048576,
      'fetch.min.bytes': 1, // Responde imediatamente com qualquer dado
      'fetch.error.backoff.ms': 100, // Backoff curto para fetch.wait.max.ms baixo

      // Queue - otimizado para menor consumo de memória
      'queued.min.messages': 1000,
      'queued.max.messages.kbytes': 65536, // 64MB ao invés de 1GB

      ...securityConfig,
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

  private getProducerConfig(): Record<string, string | number | boolean> {
    const securityConfig = this.getSecurityConfig();

    return {
      'metadata.broker.list': this.broker,
      'client.id': this.clientId,

      // Retry - otimizado para recuperação rápida
      'retry.backoff.ms': 100,
      'retry.backoff.max.ms': 1000,
      'message.send.max.retries': 5,
      'message.timeout.ms': 30000, // Timeout local para mensagens

      // Socket - otimizado para baixa latência
      'socket.timeout.ms': 10000,
      'socket.keepalive.enable': true,
      'socket.nagle.disable': true, // Desabilita Nagle para menor latência
      'socket.connection.setup.timeout.ms': 10000,

      // API e metadata
      'api.version.request': true,
      'api.version.request.timeout.ms': 10000,
      'metadata.max.age.ms': 180000,

      // Idempotência e ordering
      'enable.idempotence': true,
      'max.in.flight.requests.per.connection': 5,

      // Compressão - snappy é ideal para baixa latência
      'compression.type': 'snappy',

      // Batching - valores do environment (deve ser baixo para real-time)
      'batch.num.messages': this.batchNumMessages,
      'queue.buffering.max.messages': this.queueBufferingMaxMessages,
      'queue.buffering.max.kbytes': this.queueBufferingMaxKbytes,
      'queue.buffering.max.ms': this.queueBufferingMaxMs, // Deve ser 0-5ms para real-time

      ...securityConfig,
      dr_cb: true,
    };
  }

  createProducer(): Producer {
    const config = this.getProducerConfig();
    return new Producer(config, {});
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
    `client-${module}`,
    kafkaEnvironment.kafkaUsername,
    kafkaEnvironment.kafkaPassword,
    kafkaEnvironment.securityProtocol,
    kafkaEnvironment.saslMechanism,
    kafkaEnvironment.queueBufferingMaxMs,
    kafkaEnvironment.batchNumMessages,
    kafkaEnvironment.queueBufferingMaxMessages,
    kafkaEnvironment.queueBufferingMaxKbytes
  );

  container.register('Kafka', { useValue: kafka });

  fastify.decorate('kafka', kafka);
};

export default fp(kafkaPlugin, { name: 'kafka-plugin' });
