import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

interface RuntimeActivationInput {
  worker_id: string;
  account_id: string;
  worker_type_id?: string;
  warm_pool_id?: string;
  session_volume_name?: string;
}

export class BaileysEnvironment {
  private runtimeActivation: RuntimeActivationInput | null = null;

  public get baileysWorkerId(): string {
    const workerId = this.runtimeActivation?.worker_id ?? process.env.WORKER_ID;
    if (!workerId) {
      if (this.isWarmStandby) {
        return process.env.WARM_POOL_ID ?? 'warm-standby';
      }
      throw new InvalidConfigurationError('WORKER_ID is not defined.');
    }

    return workerId;
  }

  public get baileysAccountId(): string {
    const accountId =
      this.runtimeActivation?.account_id ?? process.env.ACCOUNT_ID;
    if (!accountId) {
      if (this.isWarmStandby) {
        return 'warm-standby';
      }
      throw new InvalidConfigurationError('ACCOUNT_ID is not defined.');
    }

    return accountId;
  }

  public get warmPoolId(): string | undefined {
    return this.runtimeActivation?.warm_pool_id ?? process.env.WARM_POOL_ID;
  }

  public get sessionVolumeName(): string | undefined {
    return (
      this.runtimeActivation?.session_volume_name ??
      process.env.SESSION_VOLUME_NAME
    );
  }

  public get isRuntimeActivated(): boolean {
    return Boolean(
      this.runtimeActivation?.worker_id ||
      (process.env.WORKER_ID && process.env.ACCOUNT_ID)
    );
  }

  public get isWarmStandby(): boolean {
    return (
      process.env.WARM_STANDBY?.trim().toLowerCase() === 'true' &&
      !this.isRuntimeActivated
    );
  }

  public activateRuntime(input: RuntimeActivationInput): {
    alreadyActive: boolean;
  } {
    if (this.runtimeActivation) {
      if (
        this.runtimeActivation.worker_id !== input.worker_id ||
        this.runtimeActivation.account_id !== input.account_id
      ) {
        throw new InvalidConfigurationError(
          'Runtime is already active for another worker.'
        );
      }

      return { alreadyActive: true };
    }

    if (
      process.env.WORKER_ID &&
      process.env.ACCOUNT_ID &&
      (process.env.WORKER_ID !== input.worker_id ||
        process.env.ACCOUNT_ID !== input.account_id)
    ) {
      throw new InvalidConfigurationError(
        'Container environment is already bound to another worker.'
      );
    }

    this.runtimeActivation = input;
    process.env.WORKER_ID = input.worker_id;
    process.env.ACCOUNT_ID = input.account_id;
    if (input.worker_type_id) {
      process.env.WORKER_TYPE_ID = input.worker_type_id;
    }
    if (input.session_volume_name) {
      process.env.SESSION_VOLUME_NAME = input.session_volume_name;
    }
    process.env.WARM_STANDBY = 'false';

    return { alreadyActive: false };
  }

  public get grpcPort(): number {
    const port = process.env.WORKER_BAILEYS_GRPC_PORT;
    return port ? parseInt(port, 10) : 50052;
  }
}
