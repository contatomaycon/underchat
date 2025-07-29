import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class RabbitMQEnvironment {
  public get url(): string {
    const url = process.env.RABBITMQ_URL;
    if (!url) {
      throw new InvalidConfigurationError('RABBITMQ_URL is not defined.');
    }

    return url;
  }
}
