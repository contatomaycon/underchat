import {
  createPlanEntitlementAuditContext,
  createPlanEntitlementTelemetryStore,
  getPlanEntitlementAuditSource,
} from '@core/services/planEntitlementTelemetryStore';

describe('Plan entitlement telemetry store', () => {
  it('aggregates only bounded labels and atomically flushes the snapshot', () => {
    const telemetry = createPlanEntitlementTelemetryStore();

    telemetry.recordDecision('public_api', 'allowed');
    telemetry.recordDecision('public_api', 'denied');
    telemetry.recordDecision('outbound_dispatcher', 'unavailable');
    telemetry.recordCache('hit');
    telemetry.recordCache('miss');
    telemetry.recordCache('redis_fallback');
    telemetry.recordCache('database_failure');
    telemetry.recordFence('install', 'success');
    telemetry.recordFence('release', 'error');
    telemetry.recordSuppression(
      'outbound_dispatcher',
      'integration_entitlement_missing'
    );

    const peek = telemetry.snapshot();
    expect(peek.decisions.public_api).toEqual({
      allowed: 1,
      denied: 1,
      unavailable: 0,
    });
    expect(peek.decisions.outbound_dispatcher.unavailable).toBe(1);
    expect(peek.cache).toEqual({
      hit: 1,
      miss: 1,
      redis_fallback: 1,
      database_failure: 1,
    });
    expect(peek.fences.install).toEqual({ success: 1, error: 0 });
    expect(peek.fences.release).toEqual({ success: 0, error: 1 });
    expect(
      peek.suppressions.outbound_dispatcher.integration_entitlement_missing
    ).toBe(1);

    expect(telemetry.flush()).toEqual(peek);
    expect(telemetry.flush()).toBeNull();
    expect(telemetry.snapshot().decisions.public_api.allowed).toBe(0);
  });

  it('keeps account and correlation identifiers in audit context only', () => {
    const audit = createPlanEntitlementAuditContext({
      surface: 'public_api',
      outcome: 'allowed',
      accountId: 'account-1',
      planProductId: 'product-1',
      revision: '7',
      source: 'addon',
      requestId: 'request-1',
      eventId: 'event-1',
    });

    expect(audit).toEqual({
      type: 'plan_entitlement_audit',
      surface: 'public_api',
      outcome: 'allowed',
      account_id: 'account-1',
      plan_product_id: 'product-1',
      revision: '7',
      source: 'addon',
      request_id: 'request-1',
      event_id: 'event-1',
    });
    expect(
      Object.keys(createPlanEntitlementTelemetryStore().snapshot())
    ).toEqual(['decisions', 'cache', 'fences', 'suppressions']);
    expect(getPlanEntitlementAuditSource({ source: 'plan' })).toBe('plan');
    expect(getPlanEntitlementAuditSource({ source: 'addon' })).toBe('addon');
    expect(getPlanEntitlementAuditSource({ source: 'untrusted' })).toBeNull();
  });
});
