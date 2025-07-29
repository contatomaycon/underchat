import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class BaileysEnvironment {
  public get baileysContainerName(): string {
    const containerName = process.env.BAILEYS_CONTAINER_NAME;
    if (!containerName) {
      throw new InvalidConfigurationError(
        'BAILEYS_CONTAINER_NAME is not defined.'
      );
    }

    return containerName;
  }
}
