import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';
import type {
  Assignment,
  KafkaConsumer,
  LibrdKafkaError,
  Producer,
  ConsumerGlobalConfig,
  ConsumerTopicConfig,
} from 'node-rdkafka';
import { rdkafka } from '@core/common/vendors/nodeRdkafka';
import {
  buildServiceApiKafkaConsumerClientId,
  isServiceApiKafkaBootstrapCutoverEnabled,
} from '@core/common/functions/serviceApiKafkaCutoverIdentity';
import { resolveKafkaSecurityConfig } from '@core/common/functions/kafkaSecurityConfig';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUPS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

/**
 * `latest-on-assignment` remains in the type only for legacy contract tests.
 * Non-test runtimes coerce it to `committed`; one-time high-watermark bootstrap
 * is performed exclusively by ServiceApiKafkaCutoverBarrier.
 */
export type KafkaConsumerStartPosition = 'committed' | 'latest-on-assignment';

export interface KafkaConsumerCreateOptions {
  startPosition?: KafkaConsumerStartPosition;
  onPartitionsAssigned?: (assignments: Assignment[]) => void;
  onPartitionsRevoked?: (assignments: Assignment[]) => void;
  onRebalanceError?: (error: unknown) => void;
}

export interface KafkaClient {
  createConsumer: (
    groupId: string,
    options?: KafkaConsumerCreateOptions
  ) => KafkaConsumer;
  createProducer: () => Producer;
  getBroker: () => string;
}

// librdkafka's stable sentinel for "the next record appended to the partition".
const KAFKA_OFFSET_END = -1;
const serviceApiWhatsappConsumerGroups = new Set<string>(
  SERVICE_API_WHATSAPP_CONSUMER_GROUPS
);

export class KafkaStreamsClient implements KafkaClient {
  private readonly broker: string;
  private readonly clientId: string;
  private readonly consumerClientId: string;
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
    queueBufferingMaxKbytes: number,
    consumerClientId?: string
  ) {
    this.broker = broker;
    this.clientId = clientId;
    this.consumerClientId = consumerClientId?.trim() || clientId;
    this.username = username;
    this.password = password;
    this.securityProtocol = securityProtocol;
    this.saslMechanism = saslMechanism;
    this.queueBufferingMaxMs = queueBufferingMaxMs;
    this.batchNumMessages = batchNumMessages;
    this.queueBufferingMaxMessages = queueBufferingMaxMessages;
    this.queueBufferingMaxKbytes = queueBufferingMaxKbytes;
  }

  private getPositiveIntegerEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }

    return Math.floor(raw);
  }

  private getMetadataConfig(): Record<string, number | boolean> {
    const refreshIntervalMs = this.getPositiveIntegerEnv(
      'KAFKA_METADATA_REFRESH_INTERVAL_MS',
      5_000
    );
    const maxAgeMs = this.getPositiveIntegerEnv(
      'KAFKA_METADATA_MAX_AGE_MS',
      Math.max(refreshIntervalMs * 3, 5_000)
    );
    const fastIntervalMs = this.getPositiveIntegerEnv(
      'KAFKA_METADATA_REFRESH_FAST_INTERVAL_MS',
      250
    );
    const fastCount = this.getPositiveIntegerEnv(
      'KAFKA_METADATA_REFRESH_FAST_COUNT',
      20
    );
    const propagationMaxMs = this.getPositiveIntegerEnv(
      'KAFKA_TOPIC_METADATA_PROPAGATION_MAX_MS',
      10_000
    );

    return {
      'metadata.max.age.ms': maxAgeMs,
      'topic.metadata.refresh.interval.ms': refreshIntervalMs,
      'topic.metadata.refresh.fast.interval.ms': fastIntervalMs,
      'topic.metadata.refresh.fast.cnt': fastCount,
      'topic.metadata.refresh.sparse': true,
      'topic.metadata.propagation.max.ms': propagationMaxMs,
    };
  }

  getBroker(): string {
    return this.broker;
  }

  private getSecurityConfig(): Record<string, string | boolean> {
    return resolveKafkaSecurityConfig({
      protocol: this.securityProtocol,
      saslMechanism: this.saslMechanism,
      username: this.username,
      password: this.password,
      caLocation: kafkaEnvironment.sslCaLocation,
    });
  }

  createConsumer(
    groupId: string,
    options: KafkaConsumerCreateOptions = {}
  ): KafkaConsumer {
    const securityConfig = this.getSecurityConfig();
    const metadataConfig = this.getMetadataConfig();
    const requestedStartPosition = options.startPosition ?? 'committed';
    const startPosition =
      requestedStartPosition === 'latest-on-assignment' &&
      process.env.NODE_ENV !== 'test'
        ? 'committed'
        : requestedStartPosition;

    const rebalanceCallback = function (
      this: KafkaConsumer,
      error: LibrdKafkaError,
      assignments: Assignment[]
    ): void {
      try {
        if (error.code === rdkafka.CODES.ERRORS.ERR__ASSIGN_PARTITIONS) {
          const targetAssignments =
            startPosition === 'latest-on-assignment'
              ? assignments.map((assignment) => ({
                  topic: assignment.topic,
                  partition: assignment.partition,
                  offset: KAFKA_OFFSET_END,
                }))
              : assignments;

          // Installing a custom rebalance callback transfers assignment
          // responsibility from librdkafka to the application. Committed
          // consumers must therefore assign the broker-provided offsets
          // unchanged: replacing them with OFFSET_END would silently discard
          // backlog, while omitting assign() would leave the member idle.
          if (this.rebalanceProtocol() === 'COOPERATIVE') {
            this.incrementalAssign(targetAssignments);
          } else {
            this.assign(targetAssignments);
          }
          options.onPartitionsAssigned?.(targetAssignments);
          return;
        }

        if (error.code === rdkafka.CODES.ERRORS.ERR__REVOKE_PARTITIONS) {
          // Fence application work before relinquishing native ownership.
          options.onPartitionsRevoked?.(assignments);
          if (this.rebalanceProtocol() === 'COOPERATIVE') {
            this.incrementalUnassign(assignments);
          } else {
            this.unassign();
          }
          return;
        }

        options.onRebalanceError?.(error);
      } catch (rebalanceError) {
        options.onRebalanceError?.(rebalanceError);
      }
    };

    const baseConfig: ConsumerGlobalConfig = {
      'group.id': groupId,
      'client.id': this.consumerClientId,
      'metadata.broker.list': this.broker,
      'enable.auto.commit': false,
      'allow.auto.create.topics': true,
      // Offsets are committed explicitly only after the runner has completed
      // work. Never let librdkafka stage an implicit fallback.
      'enable.auto.offset.store': false,
      // Keep one interoperable eager protocol across Node and WhatsMeow
      // (kafka-go). Every rebalance revokes the old assignment before the
      // replacement member resumes the coordinator-provided committed offset.
      'partition.assignment.strategy': 'range',
      rebalance_cb: rebalanceCallback,

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
      ...metadataConfig,

      // Fetch - otimizado para chat real-time (baixa latência)
      'fetch.wait.max.ms': 50, // Reduzido de 500ms para 50ms
      'fetch.message.max.bytes': 1048576,
      'fetch.min.bytes': 1, // Responde imediatamente com qualquer dado
      'fetch.error.backoff.ms': 100, // Backoff curto para fetch.wait.max.ms baixo

      // Queue - comandos locais usam tópicos de baixa volumetria; não espere lote.
      'queued.min.messages': Math.max(
        1,
        Number(process.env.KAFKA_CONSUMER_QUEUED_MIN_MESSAGES) || 1
      ),
      'queued.max.messages.kbytes': 65536, // 64MB ao invés de 1GB
      'fetch.queue.backoff.ms': Math.max(
        1,
        Number(process.env.KAFKA_CONSUMER_FETCH_QUEUE_BACKOFF_MS) || 10
      ),

      ...securityConfig,
    };

    const consumerConfig: ConsumerGlobalConfig = {
      ...baseConfig,
      'group.id': groupId,
      'metadata.broker.list': this.broker,
    };

    const topicConf: ConsumerTopicConfig = {
      'auto.offset.reset':
        startPosition === 'latest-on-assignment' ||
        serviceApiWhatsappConsumerGroups.has(groupId)
          ? 'latest'
          : 'earliest',
    };

    return new rdkafka.KafkaConsumer(consumerConfig, topicConf);
  }

  private getProducerConfig(): Record<string, string | number | boolean> {
    const securityConfig = this.getSecurityConfig();
    const metadataConfig = this.getMetadataConfig();

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
      // Local/dev clusters rely on the broker-side auto-create setting during
      // bootstrap; explicit provisioning paths still reconcile topic topology.
      'allow.auto.create.topics': true,
      ...metadataConfig,

      // Idempotência e ordering
      'enable.idempotence': true,
      // Keep the durability contract explicit even though librdkafka also
      // derives acks=all when idempotence is enabled.
      acks: -1,
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
    return new rdkafka.Producer(config, {});
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
  const startTs = Date.now();
  fastify.log.info(
    {
      module,
      broker: kafkaEnvironment.kafkaBroker,
      securityProtocol: kafkaEnvironment.securityProtocol,
      ts: startTs,
    },
    'Kafka plugin inicializando'
  );

  const clientId = `client-${module}`;
  const consumerClientId =
    module === ERouteModule.service &&
    isServiceApiKafkaBootstrapCutoverEnabled()
      ? buildServiceApiKafkaConsumerClientId(
          clientId,
          process.env.SERVICE_API_KAFKA_CUTOVER_TOKEN
        )
      : clientId;
  const kafka = new KafkaStreamsClient(
    kafkaEnvironment.kafkaBroker,
    clientId,
    kafkaEnvironment.kafkaUsername,
    kafkaEnvironment.kafkaPassword,
    kafkaEnvironment.securityProtocol,
    kafkaEnvironment.saslMechanism,
    kafkaEnvironment.queueBufferingMaxMs,
    kafkaEnvironment.batchNumMessages,
    kafkaEnvironment.queueBufferingMaxMessages,
    kafkaEnvironment.queueBufferingMaxKbytes,
    consumerClientId
  );

  container.register('Kafka', { useValue: kafka });

  fastify.decorate('kafka', kafka);
  fastify.log.info(
    { module, ms: Date.now() - startTs, ts: Date.now() },
    'Kafka plugin pronto'
  );
};

export default fp(kafkaPlugin, { name: 'kafka-plugin' });
