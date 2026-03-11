import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class BuildEnvironment {
  private normalizeString(value: string): string {
    const normalized = value.trim();
    const hasSingleQuotes =
      normalized.startsWith("'") && normalized.endsWith("'");
    const hasDoubleQuotes =
      normalized.startsWith('"') && normalized.endsWith('"');

    if (hasSingleQuotes || hasDoubleQuotes) {
      return normalized.slice(1, -1).trim();
    }

    return normalized;
  }

  private parseRequiredString(envName: string): string {
    const raw = process.env[envName];
    const normalized = raw ? this.normalizeString(raw) : '';

    if (!normalized) {
      throw new InvalidConfigurationError(`${envName} is not defined.`);
    }

    return normalized;
  }

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

  public get harborRegistry(): string {
    return this.parseRequiredString('HARBOR_REGISTRY');
  }

  public get harborNamespace(): string {
    return this.parseRequiredString('HARBOR_NAMESPACE').replace(
      /^\/+|\/+$/g,
      ''
    );
  }

  public get harborUsername(): string {
    return this.parseRequiredString('HARBOR_USERNAME');
  }

  public get harborPassword(): string {
    return this.parseRequiredString('HARBOR_PASSWORD');
  }

  public get harborAuth(): string | null {
    const raw = process.env.HARBOR_AUTH;
    if (!raw) {
      return null;
    }

    const normalized = this.normalizeString(raw);
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  public get buildGitCloneDir(): string {
    const cloneDir = process.env.BUILD_GIT_CLONE_DIR?.trim();
    if (cloneDir) {
      return cloneDir;
    }

    return '/tmp/underchat-build-source';
  }

  public get buildCommandInactivityTimeoutMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_COMMAND_INACTIVITY_TIMEOUT_MS',
      10 * 60 * 1000
    );
  }

  public get buildCommandMaxDurationMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_COMMAND_MAX_DURATION_MS',
      2 * 60 * 60 * 1000
    );
  }

  public get buildHeartbeatIntervalMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_HEARTBEAT_INTERVAL_MS',
      15 * 1000
    );
  }

  public get buildStaleRunningItemTimeoutMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_STALE_RUNNING_ITEM_TIMEOUT_MS',
      20 * 60 * 1000
    );
  }

  public get buildStaleCheckIntervalMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_STALE_CHECK_INTERVAL_MS',
      60 * 1000
    );
  }
}
