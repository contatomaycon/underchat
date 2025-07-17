import { Consumer, Kafka, logLevel, Producer } from 'kafkajs';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { kafkaEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';

const kafkaPlugin = async (fastify: FastifyInstance) => {
  const kafka = new Kafka({
    clientId: `client-${ERouteModule.manager}`,
    brokers: [kafkaEnvironment.kafkaBroker],
    connectionTimeout: 60_000,
    logLevel: logLevel.NOTHING,
  });

  const producer = kafka.producer();
  const consumer = kafka.consumer({ groupId: `group-${ERouteModule.manager}` });

  await producer.connect();
  await consumer.connect();

  container.register<Producer>('KafkaProducer', { useValue: producer });
  container.register<Consumer>('KafkaConsumer', { useValue: consumer });

  fastify.decorate('kafka', { producer, consumer });

  fastify.addHook('onClose', async () => {
    await producer.disconnect();
    await consumer.disconnect();
  });
};

export default fp(kafkaPlugin, {
  name: 'kafka-plugin',
});
