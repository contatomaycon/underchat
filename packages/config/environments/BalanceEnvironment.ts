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
    const port = process.env.BALANCER_GRPC_PORT;
    if (!port) {
      return 50051;
    }

    const parsed = Number(port);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
      throw new InvalidConfigurationError(
        'BALANCER_GRPC_PORT must be a valid port.'
      );
    }

    return parsed;
  }
}
