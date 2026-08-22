import {
  computeOutboundWebhookClaimFailureBackoffMs,
  computeOutboundWebhookRetryDelayMs,
  OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS,
  OutboundWebhookDispatcherService,
} from '@core/services/outboundWebhookDispatcher.service';
import type {
  OutboundWebhookDispatcherStore,
  PreparedOutboundWebhookDelivery,
} from '@core/services/outboundWebhookDispatcherStore';
import type {
  DispatchOutboundWebhookHttpInput,
  OutboundWebhookHttpResult,
} from '@core/common/functions/outboundWebhookHttp';

const fixedNow = new Date('2026-07-10T12:00:00.000Z');

const readyDelivery = (attemptNumber = 1): PreparedOutboundWebhookDelivery => ({
  kind: 'ready',
  deliveryId: 'delivery-1',
  webhookId: 'webhook-1',
  accountId: 'account-1',
  eventId: 'event-1',
  eventType: 'chat.created',
  payload: { id: 'event-1', type: 'chat.created', data: { value: 1 } },
  endpointUrl: 'https://example.com/hook',
  secretEncrypted: 'encrypted-secret',
  configVersion: 3,
  leaseToken: 'lease-1',
  attemptId: `attempt-${attemptNumber}`,
  attemptNumber,
});

const createHarness = (input?: {
  prepared?: Awaited<
    ReturnType<OutboundWebhookDispatcherStore['prepareAttempt']>
  >;
  httpResult?: OutboundWebhookHttpResult;
  attemptNumber?: number;
  completionSuspension?: boolean;
  leaseDurationMs?: number;
  requestTimeoutMs?: number;
}) => {
  const prepared = input?.prepared ?? readyDelivery(input?.attemptNumber ?? 1);
  const claimDue = jest.fn(async () => [
    { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
  ]);
  const prepareAttempt = jest.fn(async () => prepared);
  const completeAttempt = jest.fn(async () => ({
    applied: true,
    suspension: input?.completionSuspension
      ? {
          webhookId: 'webhook-1',
          accountId: 'account-1',
          reason: 'http_410_gone' as const,
        }
      : null,
  }));
  const store: OutboundWebhookDispatcherStore = {
    claimDue,
    prepareAttempt,
    completeAttempt,
  };
  const dispatchHttp = jest.fn(
    async (_request: DispatchOutboundWebhookHttpInput) =>
      input?.httpResult ?? {
        kind: 'response' as const,
        statusCode: 204,
        responseBody: '',
        retryAfterMs: null,
        durationMs: 25,
      }
  );
  const notify = jest.fn(async () => undefined);
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const service = new OutboundWebhookDispatcherService({
    store,
    secretDecryptor: {
      decrypt: jest.fn(() => 'uc_whsec_plain'),
    },
    options: {
      concurrency: 4,
      leaseDurationMs: input?.leaseDurationMs ?? 60_000,
      pollIntervalMs: 1_000,
      isProduction: true,
      allowLocalhostHttp: false,
      requestTimeoutMs: input?.requestTimeoutMs,
    },
    dispatchHttp,
    suspensionNotifier: { notify },
    logger,
    now: () => new Date(fixedNow),
    random: () => 0.5,
    createId: () => 'generated-id',
  });

  return {
    service,
    claimDue,
    prepareAttempt,
    completeAttempt,
    dispatchHttp,
    notify,
  };
};

const createLoopHarness = (input: {
  claimDue: OutboundWebhookDispatcherStore['claimDue'];
  random?: () => number;
}) => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const store: OutboundWebhookDispatcherStore = {
    claimDue: input.claimDue,
    prepareAttempt: jest.fn(async (prepareInput) => ({
      kind: 'lost' as const,
      deliveryId: prepareInput.claim.deliveryId,
    })),
    completeAttempt: jest.fn(async () => ({
      applied: true,
      suspension: null,
    })),
  };
  const service = new OutboundWebhookDispatcherService({
    store,
    secretDecryptor: { decrypt: jest.fn(() => 'uc_whsec_plain') },
    logger,
    options: {
      concurrency: 1,
      leaseDurationMs: 60_000,
      pollIntervalMs: 1_000,
      isProduction: true,
      allowLocalhostHttp: false,
    },
    now: () => new Date(fixedNow),
    random: input.random ?? (() => 0.5),
    createId: () => 'generated-id',
  });

  return { service, logger };
};

describe('outbound webhook dispatcher service contract', () => {
  it('marks every 2xx response successful and sends the canonical metadata', async () => {
    const harness = createHarness({
      httpResult: {
        kind: 'response',
        statusCode: 299,
        responseBody: 'accepted',
        retryAfterMs: null,
        durationMs: 14,
      },
    });

    await expect(harness.service.runOnce()).resolves.toBe(1);

    expect(harness.dispatchHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/hook',
        unixTimestamp: 1_783_684_800,
        metadata: {
          event: 'chat.created',
          eventId: 'event-1',
          deliveryId: 'delivery-1',
          attempt: 1,
          webhookConfigVersion: 3,
        },
      })
    );
    const request = harness.dispatchHttp.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty('secret');
    expect(request?.signature).toMatch(/^v1=[a-f\d]{64}$/u);
    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'succeeded',
        attemptOutcome: 'succeeded',
        httpStatus: 299,
        responseBody: 'accepted',
      })
    );
  });

  it('retries 429 using the greater of full jitter and capped Retry-After', async () => {
    const harness = createHarness({
      httpResult: {
        kind: 'response',
        statusCode: 429,
        responseBody: 'slow down',
        retryAfterMs: 90_000,
        durationMs: 10,
      },
    });

    await harness.service.runOnce();

    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'retrying',
        attemptOutcome: 'http_error',
        retryDelayMs: 90_000,
        retryAfterMs: 90_000,
      })
    );
  });

  it.each([408, 425, 500, 503, 599])(
    'retries retryable HTTP %s',
    async (statusCode) => {
      const harness = createHarness({
        httpResult: {
          kind: 'response',
          statusCode,
          responseBody: '',
          retryAfterMs: null,
          durationMs: 1,
        },
      });

      await harness.service.runOnce();

      expect(harness.completeAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryStatus: 'retrying' })
      );
    }
  );

  it.each([300, 301, 400, 401, 404, 422])(
    'treats HTTP %s as permanent',
    async (statusCode) => {
      const harness = createHarness({
        httpResult: {
          kind: 'response',
          statusCode,
          responseBody: '',
          retryAfterMs: null,
          durationMs: 1,
        },
      });

      await harness.service.runOnce();

      expect(harness.completeAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryStatus: 'dead',
          suspendImmediately: false,
        })
      );
    }
  );

  it('auto-suspends on HTTP 410 and invokes the suspension notifier', async () => {
    const harness = createHarness({
      completionSuspension: true,
      httpResult: {
        kind: 'response',
        statusCode: 410,
        responseBody: 'gone',
        retryAfterMs: null,
        durationMs: 2,
      },
    });

    await harness.service.runOnce();

    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'dead',
        suspendImmediately: true,
      })
    );
    expect(harness.notify).toHaveBeenCalledWith({
      webhookId: 'webhook-1',
      accountId: 'account-1',
      reason: 'http_410_gone',
    });
  });

  it('stops retrying a retryable failure after attempt seven', async () => {
    const harness = createHarness({
      attemptNumber: 7,
      httpResult: {
        kind: 'failure',
        code: 'ECONNRESET',
        message: 'socket reset',
        retryable: true,
        isTimeout: false,
        durationMs: 2,
      },
    });

    await harness.service.runOnce();

    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'dead',
        attemptOutcome: 'network_error',
      })
    );
  });

  it('persists timeouts as retryable timeout outcomes', async () => {
    const harness = createHarness({
      httpResult: {
        kind: 'failure',
        code: 'timeout',
        message: 'timed out',
        retryable: true,
        isTimeout: true,
        durationMs: 10_000,
      },
    });

    await harness.service.runOnce();

    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'retrying',
        attemptOutcome: 'timeout',
      })
    );
  });

  it('counts endpoint URL and DNS policy failures toward endpoint health', async () => {
    const harness = createHarness({
      httpResult: {
        kind: 'failure',
        code: 'dns_blocked_address',
        message: 'resolved to a blocked address',
        retryable: false,
        isTimeout: false,
        durationMs: 1,
      },
    });

    await harness.service.runOnce();

    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'dead',
        attemptOutcome: 'network_error',
        affectsEndpointHealth: true,
      })
    );
  });

  it('keeps the lease beyond the full HTTP timeout and completion grace', async () => {
    const harness = createHarness({
      leaseDurationMs: 1,
      requestTimeoutMs: 8_000,
    });

    await harness.service.runOnce();

    expect(harness.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ leaseDurationMs: 13_000 })
    );
    expect(harness.prepareAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ leaseDurationMs: 13_000 })
    );
  });

  it('does not make an HTTP request after preflight suppression', async () => {
    const harness = createHarness({
      prepared: {
        kind: 'suppressed',
        deliveryId: 'delivery-1',
        reason: 'config_version_changed',
      },
    });

    await harness.service.runOnce();

    expect(harness.dispatchHttp).not.toHaveBeenCalled();
    expect(harness.completeAttempt).not.toHaveBeenCalled();
  });

  it('does not make an HTTP request after losing the fenced lease', async () => {
    const harness = createHarness({
      prepared: {
        kind: 'lost',
        deliveryId: 'delivery-1',
      },
    });

    await harness.service.runOnce();

    expect(harness.dispatchHttp).not.toHaveBeenCalled();
    expect(harness.completeAttempt).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload before any network call', async () => {
    const prepared: PreparedOutboundWebhookDelivery = {
      ...readyDelivery(),
      payload: { value: 'x'.repeat(1024 * 1024) },
    };
    const harness = createHarness({ prepared });

    await harness.service.runOnce();

    expect(harness.dispatchHttp).not.toHaveBeenCalled();
    expect(harness.completeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryStatus: 'dead',
        attemptOutcome: 'internal_error',
        affectsEndpointHealth: false,
      })
    );
  });

  it('uses the declared 1m, 5m, 30m, 2h, 8h, 24h full-jitter caps', () => {
    expect(
      [1, 2, 3, 4, 5, 6].map((attemptNumber) =>
        computeOutboundWebhookRetryDelayMs({
          attemptNumber,
          retryAfterMs: null,
          random: () => 0.5,
        })
      )
    ).toEqual([30_000, 150_000, 900_000, 3_600_000, 14_400_000, 43_200_000]);
  });

  it('uses deterministic safe fallbacks for invalid retry inputs', () => {
    expect(
      computeOutboundWebhookRetryDelayMs({
        attemptNumber: 1,
        retryAfterMs: Number.NaN,
        random: () => Number.NaN,
      })
    ).toBe(30_000);
  });

  it('applies capped exponential equal-jitter backoff to claim failures', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 20].map((consecutiveFailures) =>
        computeOutboundWebhookClaimFailureBackoffMs({
          consecutiveFailures,
          pollIntervalMs: 1_000,
          random: () => 0.5,
        })
      )
    ).toEqual([1_000, 1_500, 3_000, 6_000, 12_000, 22_500, 22_500]);
    expect(
      computeOutboundWebhookClaimFailureBackoffMs({
        consecutiveFailures: 20,
        pollIntervalMs: 1_000,
        random: () => 1,
      })
    ).toBeLessThanOrEqual(OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS);
    expect(
      computeOutboundWebhookClaimFailureBackoffMs({
        consecutiveFailures: 1,
        pollIntervalMs: 60_000,
        random: () => 1,
      })
    ).toBe(OUTBOUND_WEBHOOK_CLAIM_FAILURE_BACKOFF_MAX_MS);
  });

  it('backs off failed claim cycles, resets after recovery, and stops during sleep', async () => {
    jest.useFakeTimers();
    let claimCycle = 0;
    const claimDue: OutboundWebhookDispatcherStore['claimDue'] = jest.fn(
      async () => {
        claimCycle += 1;
        if (claimCycle === 3) return [];
        throw new Error('database unavailable');
      }
    );
    const harness = createLoopHarness({ claimDue, random: () => 0.5 });

    try {
      harness.service.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(claimDue).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(999);
      expect(claimDue).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(claimDue).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1_499);
      expect(claimDue).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(claimDue).toHaveBeenCalledTimes(3);

      // A successful empty claim cycle returns to the healthy poll interval.
      await jest.advanceTimersByTimeAsync(999);
      expect(claimDue).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(1);
      expect(claimDue).toHaveBeenCalledTimes(4);
      expect(harness.logger.error).toHaveBeenLastCalledWith(
        expect.objectContaining({
          consecutive_claim_failures: 1,
          retry_delay_ms: 1_000,
        }),
        'Outbound webhook claim cycle failed'
      );

      // stop() aborts the pending backoff instead of waiting for its timer.
      await expect(harness.service.stop()).resolves.toBeUndefined();
      expect(harness.service.isRunning).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await harness.service.stop();
      jest.useRealTimers();
    }
  });

  it('does not add a polling delay after a healthy cycle claims work', async () => {
    jest.useFakeTimers();
    let claimCycle = 0;
    const claimDue: OutboundWebhookDispatcherStore['claimDue'] = jest.fn(
      async () => {
        claimCycle += 1;
        if (claimCycle === 1) {
          return [{ deliveryId: 'delivery-1', leaseToken: 'lease-1' }];
        }
        throw new Error('database unavailable');
      }
    );
    const harness = createLoopHarness({ claimDue });

    try {
      harness.service.start();
      await jest.advanceTimersByTimeAsync(0);

      expect(claimDue).toHaveBeenCalledTimes(2);
      expect(harness.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ consecutive_claim_failures: 1 }),
        'Outbound webhook claim cycle failed'
      );
    } finally {
      await harness.service.stop();
      jest.useRealTimers();
    }
  });
});
