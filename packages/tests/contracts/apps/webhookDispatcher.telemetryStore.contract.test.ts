import type { OutboundWebhookDispatcherStore } from '@core/services/outboundWebhookDispatcherStore';
import {
  createTelemetryOutboundWebhookDispatcherStore,
  isWebhookDispatcherDeliveryReady,
} from '@core/services/outboundWebhookDispatcherTelemetryStore';

const claimInput = {
  limit: 1,
  leaseToken: 'lease-1',
  leaseDurationMs: 60_000,
  now: new Date('2026-07-10T12:00:00.000Z'),
};

describe('webhook dispatcher telemetry store claim health', () => {
  it('fails readiness after consecutive claim errors and recovers on success', async () => {
    let shouldFail = true;
    const delegate: OutboundWebhookDispatcherStore = {
      claimDue: jest.fn(async () => {
        if (shouldFail) throw new Error('claim query is incompatible');
        return [];
      }),
      prepareAttempt: jest.fn(async (input) => ({
        kind: 'lost' as const,
        deliveryId: input.claim.deliveryId,
      })),
      completeAttempt: jest.fn(async () => ({
        applied: true,
        suspension: null,
      })),
    };
    const telemetry = createTelemetryOutboundWebhookDispatcherStore(delegate, {
      claimFailureThreshold: 3,
    });

    expect(telemetry.getClaimHealth()).toEqual({
      isHealthy: true,
      consecutiveFailures: 0,
      failureThreshold: 3,
    });

    await expect(telemetry.store.claimDue(claimInput)).rejects.toThrow(
      'claim query is incompatible'
    );
    await expect(telemetry.store.claimDue(claimInput)).rejects.toThrow(
      'claim query is incompatible'
    );
    expect(telemetry.getClaimHealth().isHealthy).toBe(true);

    await expect(telemetry.store.claimDue(claimInput)).rejects.toThrow(
      'claim query is incompatible'
    );
    expect(telemetry.getClaimHealth()).toEqual({
      isHealthy: false,
      consecutiveFailures: 3,
      failureThreshold: 3,
    });
    expect(
      isWebhookDispatcherDeliveryReady({
        runtimeState: 'running',
        workerFailure: null,
        isLoopRunning: true,
        claimHealth: telemetry.getClaimHealth(),
      })
    ).toBe(false);
    expect(telemetry.flush()).toEqual(
      expect.objectContaining({ claim_cycles: 0, claim_failures: 3 })
    );

    shouldFail = false;
    await expect(telemetry.store.claimDue(claimInput)).resolves.toEqual([]);
    expect(telemetry.getClaimHealth()).toEqual({
      isHealthy: true,
      consecutiveFailures: 0,
      failureThreshold: 3,
    });
    expect(
      isWebhookDispatcherDeliveryReady({
        runtimeState: 'running',
        workerFailure: null,
        isLoopRunning: true,
        claimHealth: telemetry.getClaimHealth(),
      })
    ).toBe(true);
    expect(telemetry.flush()).toEqual(
      expect.objectContaining({ claim_cycles: 1, claim_failures: 0 })
    );
  });
});
