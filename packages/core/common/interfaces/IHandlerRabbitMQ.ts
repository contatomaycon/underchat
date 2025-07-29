import * as amqp from 'amqplib';

export type IHandlerRabbitMQ = (
  content: Buffer,
  msg: amqp.ConsumeMessage,
  channel: amqp.Channel
) => Promise<void> | void;
