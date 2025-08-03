import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  KafkaStreams,
  KafkaStreamsConfig,
  CommonKafkaOptions,
} from 'kafka-streams';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';

interface KafkaStreamsPluginOptions {
  module: ERouteModule;
}

const kafkaStreamsPlugin: FastifyPluginAsync<
  KafkaStreamsPluginOptions
> = async (fastify: FastifyInstance, opts) => {
  const module = opts.module;

  console.log(`Initializing Kafka Streams for module: ${module}`);

  const noptions: CommonKafkaOptions = {
    'metadata.broker.list': kafkaEnvironment.kafkaBroker,
    'group.id': `group-underchat-streams-${module}`,
    'client.id': `client-stream-${module}`,
    'compression.codec': 'snappy',
    'enable.auto.commit': false,
    'socket.keepalive.enable': true,
    'session.timeout.ms': 6000,
    'fetch.wait.max.ms': 500,
    'fetch.message.max.bytes': 10 * 1024 * 1024,
    'queued.max.messages.kbytes': 102_400,
    'batch.num.messages': 10_000,
    'retry.backoff.ms': 500,
  };

  const tconf: KafkaStreamsConfig['tconf'] = {
    'auto.offset.reset': 'latest',
    'request.required.acks': 1,
  };

  const config: KafkaStreamsConfig = {
    kafkaHost: kafkaEnvironment.kafkaBroker,
    clientName: `client-stream-${module}`,
    groupId: `group-underchat-streams-${module}`,
    workerPerPartition: 1,
    batchOptions: {
      batchSize: 1,
      commitEveryNBatch: 1,
      concurrency: 12,
      commitSync: true,
      noBatchCommits: false,
    },
    noptions,
    tconf,
  };

  const kafkaStreams = new KafkaStreams(config);

  container.register<KafkaStreams>('KafkaStreams', { useValue: kafkaStreams });
  fastify.decorate('KafkaStreams', kafkaStreams);

  fastify.addHook('onClose', async () => {
    await kafkaStreams.closeAll();
  });
};

export default fp(kafkaStreamsPlugin, { name: 'kafka-streams-plugin' });
