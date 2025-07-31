import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class BaileysEnvironment {
  public get baileysWorkerId(): string {
    const workerId = process.env.WORKER_ID;
    if (!workerId) {
      throw new InvalidConfigurationError('WORKER_ID is not defined.');
    }

    return workerId;
  }
}
