import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class WorkerPoolEnvironment {
  private parseOptionalPositiveNumber(
    envName: string,
    defaultValue: number
  ): number {
    const raw = process.env[envName]?.trim();
    if (!raw) {
      return defaultValue;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new InvalidConfigurationError(
        `${envName} must be a positive number.`
      );
    }

    return Math.floor(parsed);
  }

  private parseOptionalBoolean(
    envName: string,
    defaultValue: boolean
  ): boolean {
    const raw = process.env[envName]?.trim();
    if (!raw) {
      return defaultValue;
    }

    const normalized = raw.toLowerCase();
    if (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    ) {
      return true;
    }

    if (
      normalized === '0' ||
      normalized === 'false' ||
      normalized === 'no' ||
      normalized === 'off'
    ) {
      return false;
    }

    throw new InvalidConfigurationError(
      `${envName} must be a boolean value (true/false).`
    );
  }

  public get warmWorkerPoolEnabled(): boolean {
    return this.parseOptionalBoolean('WARM_WORKER_POOL_ENABLED', false);
  }

  public get warmWorkerTargetReady(): number {
    return this.parseOptionalPositiveNumber('WARM_WORKER_TARGET_READY', 2);
  }

  public get warmWorkerScanIntervalSeconds(): number {
    return Math.max(
      5,
      Math.floor(
        this.parseOptionalPositiveNumber(
          'WARM_WORKER_SCAN_INTERVAL_MS',
          30000
        ) / 1000
      )
    );
  }

  public get warmWorkerReservationTtlMs(): number {
    return this.parseOptionalPositiveNumber(
      'WARM_WORKER_RESERVATION_TTL_MS',
      90_000
    );
  }
}
