import { planEntitlementTelemetryPlugin } from '@core/plugins/planEntitlementTelemetry';
import { createPlanEntitlementTelemetryStore } from '@core/services/planEntitlementTelemetryStore';

describe('Plan entitlement telemetry Fastify plugin', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes through structured logging and clears its timer on close', async () => {
    jest.useFakeTimers();
    const hooks = new Map<string, () => Promise<void>>();
    const info = jest.fn();
    const warn = jest.fn();
    const fastify = {
      log: { info, warn },
      addHook: jest.fn(
        (name: string, hook: () => Promise<void>) => void hooks.set(name, hook)
      ),
    };
    const telemetry = createPlanEntitlementTelemetryStore();

    await planEntitlementTelemetryPlugin(fastify as never, {
      intervalMs: 1_000,
      store: telemetry,
    });
    await hooks.get('onReady')?.();
    telemetry.recordDecision('manager_api', 'allowed');

    await jest.advanceTimersByTimeAsync(1_000);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_entitlement_telemetry: expect.objectContaining({
          decisions: expect.objectContaining({
            manager_api: expect.objectContaining({ allowed: 1 }),
          }),
        }),
      }),
      'Plan entitlement activity summary'
    );

    telemetry.recordDecision('public_api', 'unavailable');
    await hooks.get('onClose')?.();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_entitlement_telemetry: expect.objectContaining({
          decisions: expect.objectContaining({
            public_api: expect.objectContaining({ unavailable: 1 }),
          }),
        }),
      }),
      'Plan entitlement activity summary'
    );
    expect(jest.getTimerCount()).toBe(0);
  });
});
