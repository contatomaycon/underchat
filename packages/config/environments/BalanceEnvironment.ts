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

    const parsedPort = Number.parseInt(port, 10);
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
      throw new InvalidConfigurationError('BALANCER_GRPC_PORT is not valid.');
    }

    return parsedPort;
  }

  public get grpcHost(): string {
    const host = process.env.BALANCER_GRPC_HOST?.trim();
    return host || 'under-balance-api';
  }

  public get workerBaileysGrpcPort(): number {
    return 50052;
  }

  public get workerWwebjsGrpcPort(): number {
    return 50053;
  }
}
