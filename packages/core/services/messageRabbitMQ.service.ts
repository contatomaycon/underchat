import { injectable, inject } from 'tsyringe';
import * as amqp from 'amqplib';
import { IHandlerRabbitMQ } from '@core/common/interfaces/IHandlerRabbitMQ';

@injectable()
export class MessageRabbitMQService {
  private readonly exchange = 'underchat.exchange';
  private readonly dlx = 'underchat.dlx';

  constructor(
    @inject('RabbitMQConnection')
    private readonly connection: amqp.ChannelModel,

    @inject('RabbitMQChannel')
    private readonly channel: amqp.Channel
  ) {
    this.channel.prefetch(1);
  }

  async createQueue(queueName: string): Promise<void> {
    await this.channel.assertExchange(this.exchange, 'direct', {
      durable: true,
    });
    await this.channel.assertExchange(this.dlx, 'fanout', { durable: true });

    await this.channel.assertQueue(queueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.dlx,
        'x-queue-mode': 'lazy',
      },
    });

    await this.channel.bindQueue(queueName, this.exchange, queueName);
  }

  async send(queueName: string, payload: object | Buffer): Promise<void> {
    const data = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(JSON.stringify(payload));

    this.channel.publish(this.exchange, queueName, data, { persistent: true });
  }

  async receive(queueName: string, handler: IHandlerRabbitMQ): Promise<void> {
    this.channel.prefetch(1);

    await this.createQueue(queueName);

    this.channel.consume(
      queueName,
      async (msg) => {
        if (!msg) return;

        try {
          await handler(msg.content, msg, this.channel);

          this.channel.ack(msg);
        } catch {
          this.channel.nack(msg, false, false);
        }
      },
      { noAck: false }
    );
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
