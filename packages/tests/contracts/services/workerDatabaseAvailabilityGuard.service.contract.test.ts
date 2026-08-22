import { WorkerDatabaseAvailabilityGuard } from '@core/services/workerDatabaseAvailabilityGuard.service';

describe('WorkerDatabaseAvailabilityGuard', () => {
  let now = 0;
  let query: jest.Mock<Promise<unknown>, [unknown]>;
  let onSuspend: jest.Mock<Promise<void>, []>;
  let reacquireFence: jest.Mock<Promise<void>, []>;
  let onResume: jest.Mock<Promise<void>, []>;
  let guard: WorkerDatabaseAvailabilityGuard;

  beforeEach(async () => {
    now = 0;
    query = jest.fn<Promise<unknown>, [unknown]>(async () => ({
      rows: [{ '?column?': 1 }],
    }));
    onSuspend = jest.fn(async () => undefined);
    reacquireFence = jest.fn(async () => undefined);
    onResume = jest.fn(async () => undefined);
    guard = new WorkerDatabaseAvailabilityGuard({
      provider: 'wwebjs',
      pool: { query },
      outageGraceMs: 30_000,
      probeIntervalMs: 60_000,
      queryTimeoutMs: 1_000,
      now: () => now,
      onSuspend,
      reacquireFence,
      onResume,
    });
    guard.start();
    await guard.probeNow();
    query.mockClear();
  });

  afterEach(() => {
    guard.stop();
  });

  it('requires 30 seconds of continuous failures before suspending', async () => {
    query.mockRejectedValue(new Error('database unavailable'));

    expect((await guard.probeNow()).state).toBe('degraded');
    now = 29_999;
    expect((await guard.probeNow()).state).toBe('degraded');
    expect(onSuspend).not.toHaveBeenCalled();

    query.mockResolvedValueOnce({ rows: [] });
    expect((await guard.probeNow()).state).toBe('healthy');
    now = 60_000;
    expect((await guard.probeNow()).state).toBe('degraded');
    expect(onSuspend).not.toHaveBeenCalled();
  });

  it('suspends once and resumes only after fence reacquisition', async () => {
    const order: string[] = [];
    onSuspend.mockImplementation(async () => {
      order.push('suspend');
    });
    reacquireFence.mockImplementation(async () => {
      order.push('fence');
    });
    onResume.mockImplementation(async () => {
      order.push('resume');
    });
    query.mockRejectedValue(new Error('database unavailable'));

    await guard.probeNow();
    now = 30_000;
    expect((await guard.probeNow()).state).toBe('suspended');
    now = 35_000;
    expect((await guard.probeNow()).state).toBe('suspended');
    expect(onSuspend).toHaveBeenCalledTimes(1);

    query.mockResolvedValue({ rows: [] });
    expect((await guard.probeNow()).state).toBe('healthy');
    expect(order).toEqual(['suspend', 'fence', 'resume']);
    expect(guard.getSnapshot()).toEqual({
      state: 'healthy',
      failureStartedAt: null,
      outageMs: 0,
      suspensionApplied: false,
    });
  });

  it('suspends immediately on lease loss below the ordinary outage grace and resumes through a new fence', async () => {
    const order: string[] = [];
    onSuspend.mockImplementation(async () => {
      order.push('suspend');
    });
    reacquireFence.mockImplementation(async () => {
      order.push('fence');
    });
    onResume.mockImplementation(async () => {
      order.push('resume');
    });

    now = 1_000;
    expect((await guard.reportSessionLeaseLost()).state).toBe('suspended');
    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['suspend']);

    now = 2_000;
    query.mockResolvedValue({ rows: [] });
    expect((await guard.probeNow()).state).toBe('healthy');
    expect(order).toEqual(['suspend', 'fence', 'resume']);
  });

  it('coalesces concurrent lease-loss reports and remains stopped when stop wins', async () => {
    let releaseSuspension: (() => void) | undefined;
    onSuspend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSuspension = resolve;
        })
    );

    const first = guard.reportSessionLeaseLost();
    const second = guard.reportSessionLeaseLost();
    await Promise.resolve();
    expect(onSuspend).toHaveBeenCalledTimes(1);

    guard.stop();
    releaseSuspension?.();
    await Promise.all([first, second]);

    expect(guard.getSnapshot().state).toBe('stopped');
    expect(reacquireFence).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('invalidates an in-flight recovery when the lease is lost again and reapplies suspension after the stale resume settles', async () => {
    let releaseResume: (() => void) | undefined;
    onResume.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseResume = resolve;
        })
    );

    now = 1_000;
    await guard.reportSessionLeaseLost();
    query.mockResolvedValue({ rows: [] });
    const recovery = guard.probeNow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(reacquireFence).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);

    now = 2_000;
    await guard.reportSessionLeaseLost();
    expect(guard.getSnapshot().state).toBe('suspended');

    releaseResume?.();
    await expect(recovery).resolves.toEqual(
      expect.objectContaining({ state: 'suspended', suspensionApplied: true })
    );
    expect(onSuspend).toHaveBeenCalledTimes(3);
    expect(reacquireFence).toHaveBeenCalledTimes(1);

    onResume.mockResolvedValue(undefined);
    expect((await guard.probeNow()).state).toBe('healthy');
    expect(reacquireFence).toHaveBeenCalledTimes(2);
  });

  it('remains suspended when the new fence is rejected and retries it', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    await guard.probeNow();
    now = 30_000;
    await guard.probeNow();

    query.mockResolvedValue({ rows: [] });
    reacquireFence.mockRejectedValueOnce(new Error('stale writer'));
    expect((await guard.probeNow()).state).toBe('suspended');
    expect(onResume).not.toHaveBeenCalled();

    expect((await guard.probeNow()).state).toBe('healthy');
    expect(reacquireFence).toHaveBeenCalledTimes(2);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('does not bypass an incomplete suspension when Postgres recovers', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    await guard.probeNow();
    now = 30_000;
    onSuspend.mockRejectedValueOnce(new Error('shutdown incomplete'));
    expect((await guard.probeNow()).state).toBe('suspended');

    query.mockResolvedValue({ rows: [] });
    expect((await guard.probeNow()).state).toBe('healthy');
    expect(onSuspend).toHaveBeenCalledTimes(2);
    expect(onSuspend.mock.invocationCallOrder[1]).toBeLessThan(
      reacquireFence.mock.invocationCallOrder[0]
    );
  });

  it('serializes overlapping probes', async () => {
    let resolveQuery: (() => void) | undefined;
    query.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveQuery = resolve;
        })
    );

    const first = guard.probeNow();
    const second = guard.probeNow();
    expect(second).toBe(first);
    expect(query).toHaveBeenCalledTimes(1);
    resolveQuery?.();
    await first;
  });
});
