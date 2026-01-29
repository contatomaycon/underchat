import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class BalanceEnvironment {
  public get serverId(): string {
    const serverId = process.env.SERVER_ID;
    if (!serverId) {
      throw new InvalidConfigurationError('SERVER_ID is not defined.');
    }

    return serverId;
  }

  public get grpcPort(): number {
    return 50051;
  }

  public get grpcHost(): string {
    return 'under-balance-api';
  }
}
