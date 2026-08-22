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
    let namespace = process.env.HARBOR_NAMESPACE?.trim();
    if (!namespace) {
      throw new InvalidConfigurationError('HARBOR_NAMESPACE is not defined.');
    }

    const outerQuote = namespace[0];
    if (
      (outerQuote === '"' || outerQuote === "'") &&
      namespace.at(-1) === outerQuote
    ) {
      namespace = namespace.slice(1, -1);
    }

    const normalizedNamespace = namespace.replace(/^\/+|\/+$/g, '');
    if (!normalizedNamespace) {
      throw new InvalidConfigurationError('HARBOR_NAMESPACE is not defined.');
    }

    return normalizedNamespace;
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

    return '/var/tmp/underchat-build-source';
  }

  public get buildWorkspaceMinFreeBytes(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_WORKSPACE_MIN_FREE_BYTES',
      2 * 1024 * 1024 * 1024
    );
  }

  public get buildWorkspaceMinFreeInodes(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_WORKSPACE_MIN_FREE_INODES',
      20_000
    );
  }

  public get buildWorkspaceOrphanMaxAgeMs(): number {
    return this.parseOptionalPositiveNumber(
      'BUILD_WORKSPACE_ORPHAN_MAX_AGE_MS',
      24 * 60 * 60 * 1000
    );
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
      false
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
      true
    );
  }

  public get scheduleWorkerMonitorEnabled(): boolean {
    return this.parseOptionalBoolean('SCHEDULE_WORKER_MONITOR_ENABLED', true);
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

  public get workerImageProvisionTimeoutMs(): number {
    const timeoutMs = this.parseOptionalPositiveNumber(
      'WORKER_IMAGE_PROVISION_TIMEOUT_MS',
      5 * 60 * 1000
    );

    if (timeoutMs < 5_000 || timeoutMs > 10 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'WORKER_IMAGE_PROVISION_TIMEOUT_MS must be between 5000 and 600000.'
      );
    }

    return timeoutMs;
  }

  public get workerImageDefaultCacheTtlMs(): number {
    const ttlMs = this.parseOptionalPositiveNumber(
      'WORKER_IMAGE_DEFAULT_CACHE_TTL_MS',
      3_000
    );

    if (ttlMs < 100 || ttlMs > 30_000) {
      throw new InvalidConfigurationError(
        'WORKER_IMAGE_DEFAULT_CACHE_TTL_MS must be between 100 and 30000.'
      );
    }

    return ttlMs;
  }

  public get workerImageReconcileIntervalMs(): number {
    const intervalMs = this.parseOptionalPositiveNumber(
      'WORKER_IMAGE_RECONCILE_INTERVAL_MS',
      30_000
    );

    if (intervalMs < 5_000 || intervalMs > 5 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'WORKER_IMAGE_RECONCILE_INTERVAL_MS must be between 5000 and 300000.'
      );
    }

    return intervalMs;
  }

  public get balanceImageRolloutEnabled(): boolean {
    return this.parseOptionalBoolean('BALANCE_IMAGE_ROLLOUT_ENABLED', false);
  }

  public get balanceImageRolloutApprovedDigest(): string | null {
    const digest =
      process.env.BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST?.trim().toLowerCase();
    if (!digest) {
      return null;
    }

    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_APPROVED_DIGEST must be a sha256 digest.'
      );
    }

    return digest;
  }

  public get balanceImageRolloutServerIds(): readonly string[] {
    const raw = process.env.BALANCE_IMAGE_ROLLOUT_SERVER_IDS?.trim();
    if (!raw) {
      return [];
    }

    const serverIds = Array.from(
      new Set(
        raw
          .split(',')
          .map((serverId) => serverId.trim())
          .filter(Boolean)
      )
    );

    if (
      serverIds.some(
        (serverId) => serverId !== '*' && !/^[a-f0-9-]{20,64}$/iu.test(serverId)
      )
    ) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_SERVER_IDS must contain server UUIDs or "*".'
      );
    }

    if (serverIds.includes('*') && serverIds.length > 1) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_SERVER_IDS cannot combine "*" with server UUIDs.'
      );
    }

    return serverIds;
  }

  public get balanceImageRolloutReadinessTimeoutMs(): number {
    const timeoutMs = this.parseOptionalPositiveNumber(
      'BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS',
      7 * 60 * 1000
    );

    if (timeoutMs < 60_000 || timeoutMs > 10 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_READINESS_TIMEOUT_MS must be between 60000 and 600000.'
      );
    }

    return timeoutMs;
  }

  public get balanceImageRolloutStabilityWindowMs(): number {
    const stabilityMs = this.parseOptionalPositiveNumber(
      'BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS',
      2 * 60 * 1000
    );

    if (stabilityMs < 30_000 || stabilityMs > 30 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_STABILITY_WINDOW_MS must be between 30000 and 1800000.'
      );
    }

    return stabilityMs;
  }

  public get balanceImageRolloutRetryCooldownMs(): number {
    const cooldownMs = this.parseOptionalPositiveNumber(
      'BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS',
      15 * 60 * 1000
    );

    if (cooldownMs < 60_000 || cooldownMs > 24 * 60 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_RETRY_COOLDOWN_MS must be between 60000 and 86400000.'
      );
    }

    return cooldownMs;
  }

  public get balanceImageRolloutCommandTimeoutMs(): number {
    const timeoutMs = this.parseOptionalPositiveNumber(
      'BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS',
      15 * 60 * 1000
    );

    if (timeoutMs < 2 * 60 * 1000 || timeoutMs > 20 * 60 * 1000) {
      throw new InvalidConfigurationError(
        'BALANCE_IMAGE_ROLLOUT_COMMAND_TIMEOUT_MS must be between 120000 and 1200000.'
      );
    }

    return timeoutMs;
  }
}
