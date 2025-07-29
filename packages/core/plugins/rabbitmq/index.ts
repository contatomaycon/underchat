import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import * as amqp from 'amqplib';
import { container } from 'tsyringe';
import { rabbitMQEnvironment } from '@core/config/environments';

const rabbitmqPlugin = async (fastify: FastifyInstance) => {
  const connection = await amqp.connect(rabbitMQEnvironment.url);
  const channel = await connection.createChannel();

  container.register<amqp.ChannelModel>('RabbitMQConnection', {
    useValue: connection,
  });
  container.register<amqp.Channel>('RabbitMQChannel', { useValue: channel });

  fastify.decorate<amqp.ChannelModel>('RabbitMQConnection', connection);
  fastify.decorate<amqp.Channel>('RabbitMQChannel', channel);

  fastify.addHook('onClose', async () => {
    await channel.close();
    await connection.close();
  });
};

export default fp(rabbitmqPlugin, { name: 'rabbitmq-plugin' });
