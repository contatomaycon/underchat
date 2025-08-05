import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class BalanceEnvironment {
  public get serverId(): string {
    const serverId = process.env.SERVER_ID;
    if (!serverId) {
      throw new InvalidConfigurationError('SERVER_ID is not defined.');
    }

    return serverId;
  }
}
