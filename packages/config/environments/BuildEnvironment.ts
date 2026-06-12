import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export type TBuildEngine = 'docker' | 'kaniko';

export class BuildEnvironment {
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

  public get harborRegistry(): string {
    const registry = process.env.HARBOR_REGISTRY?.trim();
    if (!registry) {
      throw new InvalidConfigurationError('HARBOR_REGISTRY is not defined.');
    }

    return registry;
  }

  public get harborNamespace(): string {
    const namespace = process.env.HARBOR_NAMESPACE?.trim();
    if (!namespace) {
      throw new InvalidConfigurationError('HARBOR_NAMESPACE is not defined.');
    }

    return namespace.replace(/^\/+|\/+$/g, '');
  }

  public get harborUsername(): string {
    const username = process.env.HARBOR_USERNAME?.trim();
    if (!username) {
      throw new InvalidConfigurationError('HARBOR_USERNAME is not defined.');
    }

    return username;
  }

  public get harborPassword(): string {
    const password = process.env.HARBOR_PASSWORD?.trim();
    if (!password) {
      throw new InvalidConfigurationError('HARBOR_PASSWORD is not defined.');
    }

    return password;
  }

  public get buildGitCloneDir(): string {
    const cloneDir = process.env.BUILD_GIT_CLONE_DIR?.trim();
    if (cloneDir) {
      return cloneDir;
    }

    return '/tmp/underchat-build-source';
  }

  public get buildEngine(): TBuildEngine {
    const engineRaw = process.env.BUILD_ENGINE?.trim().toLowerCase();
    if (!engineRaw) {
      return 'docker';
    }

    if (engineRaw !== 'docker' && engineRaw !== 'kaniko') {
      throw new InvalidConfigurationError(
        'BUILD_ENGINE must be one of: docker, kaniko.'
      );
    }

    return engineRaw;
  }

  public get buildKanikoExecutorPath(): string {
    const executorPath = process.env.BUILD_KANIKO_EXECUTOR_PATH?.trim();
    if (!executorPath) {
      return '/kaniko/executor';
    }

    return executorPath;
  }

  public get serviceApiEnableBuildConsumers(): boolean {
    return this.parseOptionalBoolean(
      'SERVICE_API_ENABLE_BUILD_CONSUMERS',
      true
    );
  }

  public get serviceApiEnableNonBuildConsumers(): boolean {
    return this.parseOptionalBoolean(
      'SERVICE_API_ENABLE_NON_BUILD_CONSUMERS',
      true
    );
  }

  public get serviceApiHealthFailOnKafkaUnhealthy(): boolean {
    return this.parseOptionalBoolean(
      'SERVICE_API_HEALTH_FAIL_ON_KAFKA_UNHEALTHY',
      false
    );
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
