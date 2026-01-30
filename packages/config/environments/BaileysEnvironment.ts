import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class BaileysEnvironment {
  public get baileysWorkerId(): string {
    const workerId = process.env.WORKER_ID;
    if (!workerId) {
      throw new InvalidConfigurationError('WORKER_ID is not defined.');
    }

    return workerId;
  }

  public get baileysAccountId(): string {
    const accountId = process.env.ACCOUNT_ID;
    if (!accountId) {
      throw new InvalidConfigurationError('ACCOUNT_ID is not defined.');
    }

    return accountId;
  }

  public get grpcPort(): number {
    const port = process.env.WORKER_BAILEYS_GRPC_PORT;
    return port ? parseInt(port, 10) : 50052;
  }
}
