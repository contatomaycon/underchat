describe('service API Kafka consumer registry', () => {
  const previousGrace = process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS;
  const previousRecoveryTimeout =
    process.env.SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS;

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    if (previousGrace === undefined) {
      delete process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS;
    } else {
      process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = previousGrace;
    }
    if (previousRecoveryTimeout === undefined) {
      delete process.env.SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS;
    } else {
      process.env.SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS =
        previousRecoveryTimeout;
    }
  });

  it('tracks startup as starting, ready, and failed across explicit attempts', async () => {
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        getServiceApiConsumerStartupState(): 'starting' | 'ready' | 'failed';
        isServiceApiConsumerStartupPending(): boolean;
        hasServiceApiConsumerStartupFailed(): boolean;
        trackServiceApiConsumerStartup(
          startup: () => Promise<void>
        ): Promise<void>;
      };
    let finishStartup: (() => void) | undefined;
    const startupAttempt = registry.trackServiceApiConsumerStartup(
      () =>
        new Promise<void>((resolve) => {
          finishStartup = resolve;
        })
    );

    expect(registry.getServiceApiConsumerStartupState()).toBe('starting');
    expect(registry.isServiceApiConsumerStartupPending()).toBe(true);
    expect(registry.hasServiceApiConsumerStartupFailed()).toBe(false);

    finishStartup?.();
    await startupAttempt;

    expect(registry.getServiceApiConsumerStartupState()).toBe('ready');
    expect(registry.isServiceApiConsumerStartupPending()).toBe(false);
    expect(registry.hasServiceApiConsumerStartupFailed()).toBe(false);

    await expect(
      registry.trackServiceApiConsumerStartup(async () => {
        throw new Error('startup_failed');
      })
    ).rejects.toThrow('startup_failed');

    expect(registry.getServiceApiConsumerStartupState()).toBe('failed');
    expect(registry.isServiceApiConsumerStartupPending()).toBe(false);
    expect(registry.hasServiceApiConsumerStartupFailed()).toBe(true);
  });

  it('keeps a registered consumer visible and marks it unhealthy after the startup grace', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    process.env.SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS = '30000';
    jest.resetModules();

    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        getServiceApiKafkaHealthSnapshots(): Array<{
          owner: string;
          missing?: boolean;
          unhealthy?: boolean;
          stall_reason?: string;
        }>;
        hasUnhealthyServiceApiKafkaConsumer(): boolean;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
        hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean;
      };
    class MissingConsumer {
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(new MissingConsumer());

    expect(registry.getServiceApiKafkaHealthSnapshots()).toEqual([
      expect.objectContaining({
        owner: 'MissingConsumer',
        missing: true,
        unhealthy: false,
      }),
    ]);
    expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(false);
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);

    jest.advanceTimersByTime(1_000);

    expect(registry.getServiceApiKafkaHealthSnapshots()).toEqual([
      expect.objectContaining({
        owner: 'MissingConsumer',
        missing: true,
        unhealthy: true,
        stall_reason: 'missing_consumer_health_snapshot',
      }),
    ]);
    expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
      false
    );

    jest.advanceTimersByTime(29_000);

    expect(registry.getServiceApiKafkaHealthSnapshots()[0]).toEqual(
      expect.objectContaining({
        missing: true,
        health_snapshot_missing_age_ms: 30_000,
        health_snapshot_recovery_exhausted: true,
      })
    );
    expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
      true
    );
  });

  it('keeps a global disconnect unready without requesting pod replacement', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    process.env.SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS = '30000';
    jest.resetModules();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        getServiceApiKafkaHealthSnapshots(): Array<{
          connected: boolean;
          consuming: boolean;
          unhealthy?: boolean;
          assignments?: unknown[];
        }>;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
        hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean;
      };
    const health = {
      group_id: 'group-test',
      start_position: 'committed',
      assignments_ready: false,
      assignment_positioning_count: 0,
      topics: ['upsert.message'],
      connected: false,
      consuming: false,
      unhealthy: false,
      assignments: [],
      restart_count: 0,
      last_message_at: 0,
      last_commit_at: 0,
      last_restart_at: 0,
      last_error: '',
    };
    class ManagedOwner {
      consumer = { __health: () => health };
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(new ManagedOwner());
    jest.advanceTimersByTime(1_000);

    expect(registry.getServiceApiKafkaHealthSnapshots()[0]).toEqual(
      expect.objectContaining({
        connected: false,
        consuming: false,
        unhealthy: true,
      })
    );
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
      false
    );

    jest.advanceTimersByTime(30_000);

    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
      false
    );

    health.connected = true;
    health.consuming = true;
    health.assignments_ready = true;

    expect(registry.getServiceApiKafkaHealthSnapshots()[0]).toEqual(
      expect.objectContaining({
        connected: true,
        consuming: true,
        assignments: [],
        unhealthy: false,
      })
    );
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(false);
  });

  it.each([
    'pending_offset_stall',
    'lag_no_commit_progress',
    'lag_measurement_unavailable',
  ])(
    'fails readiness when a connected central consumer reports %s',
    (stallReason) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
      process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
      jest.resetModules();
      const registry =
        require('../../../../apps/service_api/src/consumer/registry') as {
          registerServiceApiConsumer(consumer: {
            close?: () => Promise<void>;
          }): void;
          getServiceApiKafkaHealthSnapshots(): Array<{
            unhealthy?: boolean;
            stall_reason?: string;
          }>;
          hasUnhealthyServiceApiKafkaConsumer(): boolean;
          hasUnreadyServiceApiKafkaConsumer(): boolean;
        };
      class StalledOwner {
        consumer = {
          __health: () => ({
            group_id: 'group-test',
            start_position: 'committed',
            assignments_ready: true,
            assignment_positioning_count: 0,
            topics: ['upsert.message'],
            connected: true,
            consuming: true,
            unhealthy: false,
            stall_reason: stallReason,
            assignments: [{ topic: 'upsert.message', partition: 0 }],
            restart_count: 0,
            last_message_at: 0,
            last_commit_at: 0,
            last_restart_at: 0,
            last_error: '',
          }),
        };
        async close(): Promise<void> {}
      }
      registry.registerServiceApiConsumer(new StalledOwner());
      jest.advanceTimersByTime(1_000);

      expect(registry.getServiceApiKafkaHealthSnapshots()[0]).toEqual(
        expect.objectContaining({
          unhealthy: true,
          stall_reason: stallReason,
        })
      );
      expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
      expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
    }
  );

  it('requests pod replacement when a native consumer disconnect times out', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    jest.resetModules();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
        hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean;
      };
    class NativeDisconnectTimeoutConsumer {
      consumer = {
        __health: () => ({
          group_id: 'group-native-disconnect-timeout',
          start_position: 'committed',
          assignments_ready: false,
          assignment_positioning_count: 0,
          topics: ['asaas.nfse.webhook'],
          connected: false,
          consuming: true,
          unhealthy: true,
          stall_reason: 'native_disconnect_timeout',
          assignments: [],
          restart_count: 1,
          consecutive_stall_restart_count: 0,
          stall_recovery_exhausted: false,
          pod_replacement_required: true,
          pod_replacement_reason: 'native_disconnect_timeout',
          last_message_at: 0,
          last_commit_at: 0,
          last_restart_at: Date.now(),
          last_error: 'Kafka consumer disconnect timed out',
        }),
      };
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(new NativeDisconnectTimeoutConsumer());
    jest.advanceTimersByTime(1_000);

    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
      true
    );
  });

  it.each([
    ['create.server', 'pending_offset_stall'],
    ['asaas.nfse.webhook', 'lag_no_commit_progress'],
    ['create.server', 'pending_offset_stall_watchdog'],
    ['asaas.nfse.webhook', 'lag_no_commit_progress_watchdog'],
  ])(
    'keeps HTTP readiness while internal recovery runs but replaces an exhausted administrative consumer for %s/%s',
    (topic, stallReason) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
      process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
      jest.resetModules();
      const registry =
        require('../../../../apps/service_api/src/consumer/registry') as {
          registerServiceApiConsumer(consumer: {
            close?: () => Promise<void>;
          }): void;
          getServiceApiKafkaHealthSnapshots(): Array<{
            unhealthy?: boolean;
            stall_reason?: string;
          }>;
          hasUnhealthyServiceApiKafkaConsumer(): boolean;
          hasUnreadyServiceApiKafkaConsumer(): boolean;
          hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean;
        };
      class AdministrativeConsumer {
        consumer = {
          __health: () => ({
            group_id: `group-${topic}`,
            start_position: 'committed',
            assignments_ready: true,
            assignment_positioning_count: 0,
            topics: [topic],
            connected: true,
            consuming: true,
            unhealthy: true,
            stall_reason: stallReason,
            assignments: [{ topic, partition: 0 }],
            restart_count: 1,
            consecutive_stall_restart_count: 3,
            stall_recovery_exhausted: true,
            last_message_at: Date.now() - 60_000,
            last_commit_at: Date.now() - 60_000,
            last_restart_at: Date.now() - 10_000,
            last_error: stallReason,
          }),
        };
        async close(): Promise<void> {}
      }
      registry.registerServiceApiConsumer(new AdministrativeConsumer());
      jest.advanceTimersByTime(1_000);

      expect(registry.getServiceApiKafkaHealthSnapshots()[0]).toEqual(
        expect.objectContaining({
          unhealthy: true,
          stall_reason: stallReason,
        })
      );
      expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
      expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(false);
      expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
        true
      );
    }
  );

  it.each([
    'worker.lifecycle.request',
    'worker.warm.replenish.request',
    'upsert.message',
  ])(
    'fails readiness for %s and requests pod replacement only after internal recovery is exhausted',
    (topic) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
      process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
      jest.resetModules();
      const registry =
        require('../../../../apps/service_api/src/consumer/registry') as {
          registerServiceApiConsumer(consumer: {
            close?: () => Promise<void>;
          }): void;
          hasUnhealthyServiceApiKafkaConsumer(): boolean;
          hasUnreadyServiceApiKafkaConsumer(): boolean;
          hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean;
        };
      const health = {
        group_id: `group-${topic}`,
        start_position: 'committed',
        assignments_ready: true,
        assignment_positioning_count: 0,
        topics: [topic],
        connected: true,
        consuming: true,
        unhealthy: true,
        stall_reason: 'lag_no_commit_progress',
        assignments: [{ topic, partition: 23 }],
        restart_count: 2,
        consecutive_stall_restart_count: 2,
        stall_recovery_exhausted: false,
        stall_restart_enabled: true,
        last_message_at: Date.now() - 180_000,
        last_commit_at: Date.now() - 180_000,
        last_restart_at: Date.now() - 90_000,
        last_error: 'lag_no_commit_progress',
      };
      class CriticalDurableConsumer {
        consumer = { __health: () => health };
        async close(): Promise<void> {}
      }
      registry.registerServiceApiConsumer(new CriticalDurableConsumer());
      jest.advanceTimersByTime(1_000);

      expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
      expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
      expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
        false
      );

      health.restart_count = 3;
      health.consecutive_stall_restart_count = 3;
      health.stall_recovery_exhausted = true;

      expect(registry.hasServiceApiKafkaConsumerRequiringPodReplacement()).toBe(
        true
      );
    }
  );

  it('keeps a disconnected committed administrative consumer fail-closed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    jest.resetModules();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        hasUnhealthyServiceApiKafkaConsumer(): boolean;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
      };
    class DisconnectedAdministrativeConsumer {
      consumer = {
        __health: () => ({
          group_id: 'group-underchat-balance-creator',
          start_position: 'committed',
          assignments_ready: true,
          assignment_positioning_count: 0,
          topics: ['create.server'],
          connected: false,
          consuming: false,
          unhealthy: true,
          stall_reason: 'lag_no_commit_progress',
          assignments: [],
          restart_count: 1,
          last_message_at: 0,
          last_commit_at: 0,
          last_restart_at: 0,
          last_error: 'Connection is closed',
        }),
      };
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(
      new DisconnectedAdministrativeConsumer()
    );
    jest.advanceTimersByTime(1_000);

    expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
  });

  it('does not classify an unknown administrative processing stall as readiness-critical', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    jest.resetModules();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        hasUnhealthyServiceApiKafkaConsumer(): boolean;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
      };
    class UnknownAdministrativeConsumer {
      consumer = {
        __health: () => ({
          group_id: 'group-future-administrative',
          start_position: 'committed',
          assignments_ready: true,
          assignment_positioning_count: 0,
          topics: ['future.whatsapp.event'],
          connected: true,
          consuming: true,
          unhealthy: true,
          stall_reason: 'pending_offset_stall',
          assignments: [{ topic: 'future.whatsapp.event', partition: 0 }],
          restart_count: 1,
          last_message_at: 0,
          last_commit_at: 0,
          last_restart_at: 0,
          last_error: 'pending_offset_stall',
        }),
      };
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(new UnknownAdministrativeConsumer());
    jest.advanceTimersByTime(1_000);

    expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(false);
  });

  it('keeps a WhatsApp policy topic fail-closed even if its snapshot reports committed', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
    process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS = '1000';
    jest.resetModules();
    const registry =
      require('../../../../apps/service_api/src/consumer/registry') as {
        registerServiceApiConsumer(consumer: {
          close?: () => Promise<void>;
        }): void;
        hasUnhealthyServiceApiKafkaConsumer(): boolean;
        hasUnreadyServiceApiKafkaConsumer(): boolean;
      };
    class MisreportedWhatsappConsumer {
      consumer = {
        __health: () => ({
          group_id: 'group-underchat-message-upsert',
          start_position: 'committed',
          assignments_ready: true,
          assignment_positioning_count: 0,
          topics: ['upsert.message'],
          connected: true,
          consuming: true,
          unhealthy: true,
          stall_reason: 'lag_no_commit_progress',
          assignments: [{ topic: 'upsert.message', partition: 0 }],
          restart_count: 1,
          last_message_at: 0,
          last_commit_at: 0,
          last_restart_at: 0,
          last_error: 'lag_no_commit_progress',
        }),
      };
      async close(): Promise<void> {}
    }
    registry.registerServiceApiConsumer(new MisreportedWhatsappConsumer());
    jest.advanceTimersByTime(1_000);

    expect(registry.hasUnhealthyServiceApiKafkaConsumer()).toBe(true);
    expect(registry.hasUnreadyServiceApiKafkaConsumer()).toBe(true);
  });
});
