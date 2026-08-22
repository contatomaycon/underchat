import { BuildEnvironment } from '@core/config/environments/BuildEnvironment';

describe('BuildEnvironment reliability defaults', () => {
  const workspaceEnvironmentNames = [
    'BUILD_GIT_CLONE_DIR',
    'BUILD_WORKSPACE_MIN_FREE_BYTES',
    'BUILD_WORKSPACE_MIN_FREE_INODES',
    'BUILD_WORKSPACE_ORPHAN_MAX_AGE_MS',
  ] as const;
  const originalBuildConsumersSetting =
    process.env.SERVICE_API_ENABLE_BUILD_CONSUMERS;
  const originalNonBuildConsumersSetting =
    process.env.SERVICE_API_ENABLE_NON_BUILD_CONSUMERS;
  const originalKafkaHealthSetting =
    process.env.SERVICE_API_HEALTH_FAIL_ON_KAFKA_UNHEALTHY;
  const originalScheduleWorkerMonitorSetting =
    process.env.SCHEDULE_WORKER_MONITOR_ENABLED;
  const originalWorkspaceSettings = Object.fromEntries(
    workspaceEnvironmentNames.map((name) => [name, process.env[name]])
  ) as Record<(typeof workspaceEnvironmentNames)[number], string | undefined>;

  afterEach(() => {
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[name];
        return;
      }

      process.env[name] = value;
    };

    restore(
      'SERVICE_API_ENABLE_BUILD_CONSUMERS',
      originalBuildConsumersSetting
    );
    restore(
      'SERVICE_API_ENABLE_NON_BUILD_CONSUMERS',
      originalNonBuildConsumersSetting
    );
    restore(
      'SERVICE_API_HEALTH_FAIL_ON_KAFKA_UNHEALTHY',
      originalKafkaHealthSetting
    );
    restore(
      'SCHEDULE_WORKER_MONITOR_ENABLED',
      originalScheduleWorkerMonitorSetting
    );
    for (const name of workspaceEnvironmentNames) {
      restore(name, originalWorkspaceSettings[name]);
    }
  });

  it('keeps build work off the main Service role by default', () => {
    delete process.env.SERVICE_API_ENABLE_BUILD_CONSUMERS;
    delete process.env.SERVICE_API_ENABLE_NON_BUILD_CONSUMERS;

    const environment = new BuildEnvironment();

    expect(environment.serviceApiEnableBuildConsumers).toBe(false);
    expect(environment.serviceApiEnableNonBuildConsumers).toBe(true);
  });

  it('allows the dedicated build runner to opt into only build consumers', () => {
    process.env.SERVICE_API_ENABLE_BUILD_CONSUMERS = 'true';
    process.env.SERVICE_API_ENABLE_NON_BUILD_CONSUMERS = 'false';

    const environment = new BuildEnvironment();

    expect(environment.serviceApiEnableBuildConsumers).toBe(true);
    expect(environment.serviceApiEnableNonBuildConsumers).toBe(false);
  });

  it('fails health closed on an unhealthy Kafka consumer without requiring an env override', () => {
    delete process.env.SERVICE_API_HEALTH_FAIL_ON_KAFKA_UNHEALTHY;

    expect(new BuildEnvironment().serviceApiHealthFailOnKafkaUnhealthy).toBe(
      true
    );
  });

  it('still honors an explicit opt-out', () => {
    process.env.SERVICE_API_HEALTH_FAIL_ON_KAFKA_UNHEALTHY = 'false';

    expect(new BuildEnvironment().serviceApiHealthFailOnKafkaUnhealthy).toBe(
      false
    );
  });

  it('keeps active worker self-recovery enabled when its optional schedule setting is absent', () => {
    delete process.env.SCHEDULE_WORKER_MONITOR_ENABLED;

    expect(new BuildEnvironment().scheduleWorkerMonitorEnabled).toBe(true);
  });

  it('allows a staged rollout to pause only the active worker monitor explicitly', () => {
    process.env.SCHEDULE_WORKER_MONITOR_ENABLED = 'false';

    expect(new BuildEnvironment().scheduleWorkerMonitorEnabled).toBe(false);
  });

  it('provides disk-backed workspace reliability defaults', () => {
    for (const name of workspaceEnvironmentNames) {
      delete process.env[name];
    }

    const environment = new BuildEnvironment();

    expect({
      cloneDir: environment.buildGitCloneDir,
      minFreeBytes: environment.buildWorkspaceMinFreeBytes,
      minFreeInodes: environment.buildWorkspaceMinFreeInodes,
      orphanMaxAgeMs: environment.buildWorkspaceOrphanMaxAgeMs,
    }).toEqual({
      cloneDir: '/var/tmp/underchat-build-source',
      minFreeBytes: 2 * 1024 * 1024 * 1024,
      minFreeInodes: 20_000,
      orphanMaxAgeMs: 24 * 60 * 60 * 1000,
    });
  });

  it('honors explicit workspace reliability overrides', () => {
    process.env.BUILD_GIT_CLONE_DIR = '/mnt/build-workspaces';
    process.env.BUILD_WORKSPACE_MIN_FREE_BYTES = '3221225472';
    process.env.BUILD_WORKSPACE_MIN_FREE_INODES = '45000';
    process.env.BUILD_WORKSPACE_ORPHAN_MAX_AGE_MS = '3600000';

    const environment = new BuildEnvironment();

    expect({
      cloneDir: environment.buildGitCloneDir,
      minFreeBytes: environment.buildWorkspaceMinFreeBytes,
      minFreeInodes: environment.buildWorkspaceMinFreeInodes,
      orphanMaxAgeMs: environment.buildWorkspaceOrphanMaxAgeMs,
    }).toEqual({
      cloneDir: '/mnt/build-workspaces',
      minFreeBytes: 3_221_225_472,
      minFreeInodes: 45_000,
      orphanMaxAgeMs: 3_600_000,
    });
  });
});
