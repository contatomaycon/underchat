import { DrizzleOutboundWebhookDispatcherStore } from '@core/services/outboundWebhookDispatcherStore';

const collectSqlParts = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap(collectSqlParts);
  }
  if (Array.isArray(record.value)) {
    return record.value.flatMap(collectSqlParts);
  }
  if ('value' in record && typeof record.value !== 'object') {
    return [String(record.value)];
  }
  return [];
};

const createTransactionDb = (results: unknown[]) => {
  const execute = jest.fn(
    async (_query: unknown): Promise<unknown> => results.shift() ?? { rows: [] }
  );
  const rolledBack = jest.fn();
  const transaction = jest.fn(
    async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => {
      try {
        return await callback({ execute });
      } catch (error: unknown) {
        rolledBack();
        throw error;
      }
    }
  );
  return { db: { transaction }, execute, rolledBack, transaction };
};

const preparationRow = {
  outbound_webhook_delivery_id: 'delivery-1',
  outbound_webhook_id: 'webhook-1',
  account_id: 'account-1',
  outbound_webhook_event_id: 'event-1',
  event_type: 'chat.created',
  integration_entitlement_revision: '7',
  integration_entitlement_source: 'addon',
  payload: { id: 'event-1' },
  url: 'https://example.com/hook',
  secret_encrypted: 'encrypted',
  delivery_config_version: 3,
  webhook_config_version: 3,
  attempt_count: 0,
  delivery_is_current: true,
  endpoint_is_eligible: true,
  event_is_ready: true,
  channel_is_available: true,
  channel_scope_matches: true,
  subscription_is_active: true,
  account_is_eligible: true,
  plan_is_eligible: true,
  integration_is_eligible: true,
  integration_revision_matches: true,
};

describe('outbound webhook dispatcher store contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies the server timeout with SET LOCAL inside each transaction', async () => {
    const database = createTransactionDb([
      { rows: [] },
      {
        rows: [
          {
            outbound_webhook_delivery_id: 'delivery-1',
            lease_token: 'lease-1',
          },
        ],
      },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never,
      30_000
    );

    await expect(
      store.claimDue({
        limit: 1,
        leaseToken: 'lease-1',
        leaseDurationMs: 60_000,
        now: new Date('2026-07-10T12:00:00.000Z'),
      })
    ).resolves.toEqual([{ deliveryId: 'delivery-1', leaseToken: 'lease-1' }]);

    const localTimeout = collectSqlParts(
      database.execute.mock.calls[0]?.[0]
    ).join(' ');
    const claim = collectSqlParts(database.execute.mock.calls[1]?.[0]).join(
      ' '
    );
    expect(localTimeout).toContain('set_config');
    expect(localTimeout).toContain('statement_timeout');
    expect(localTimeout).toContain('30000');
    expect(localTimeout).toContain('true');
    expect(claim).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('claims due and expired-lease rows using a short SKIP LOCKED transaction', async () => {
    const database = createTransactionDb([
      {
        rows: [
          {
            outbound_webhook_delivery_id: 'delivery-1',
            lease_token: 'lease-1',
          },
        ],
      },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.claimDue({
        limit: 10,
        leaseToken: 'lease-1',
        leaseDurationMs: 60_000,
        now: new Date('2026-07-10T12:00:00.000Z'),
      })
    ).resolves.toEqual([{ deliveryId: 'delivery-1', leaseToken: 'lease-1' }]);

    const query = collectSqlParts(database.execute.mock.calls[0]?.[0]).join(
      ' '
    );
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain('next_attempt_at');
    expect(query).toContain('next_attempt_at <= clock_timestamp()');
    expect(query).toContain('lease_expires_at');
    expect(query).toContain('abandoned_attempts');
    expect(query).toContain('lease_expired_attempts_exhausted');
    expect(query).toContain('attempt_count');
    expect(query).toContain('lease_expired');
    expect(query).toContain('pending');
    expect(query).toContain('retrying');
    expect(query).toContain('leased');
    expect(query).toContain('clock_timestamp');
    expect(query).toContain("INTERVAL '1 millisecond'");
    expect(query).toContain('60000');
    expect(query).not.toContain('2026-07-10T12:01:00.000Z');
  });

  it('revalidates control-test exception, subscription, event, account, and latest plan on RW', async () => {
    const auditLog = jest.spyOn(console, 'info').mockImplementation(() => {});
    const database = createTransactionDb([
      { rows: [preparationRow] },
      { rows: [] },
      {
        rows: [{ outbound_webhook_delivery_id: 'delivery-1' }],
      },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.prepareAttempt({
        claim: { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
        attemptId: 'attempt-1',
        leaseDurationMs: 60_000,
        now: new Date('2026-07-10T12:00:00.000Z'),
      })
    ).resolves.toMatchObject({
      kind: 'ready',
      deliveryId: 'delivery-1',
      configVersion: 3,
      attemptNumber: 1,
    });

    const preflight = collectSqlParts(database.execute.mock.calls[0]?.[0]).join(
      ' '
    );
    expect(preflight).toContain("event.event_type = 'webhook.test'");
    expect(preflight).toContain('event.is_test = TRUE');
    expect(preflight).toContain("event.state = 'ready'");
    expect(preflight).toContain('outbound_webhook_subscription');
    expect(preflight).toContain('account.account_status_id');
    expect(preflight).toContain('latest_plan_account');
    expect(preflight).toContain('integration_plan_item');
    expect(preflight).toContain('integration_addon_account');
    expect(preflight).toContain('account_plan_product_entitlement_revision');
    expect(preflight).toContain('integration_entitlement_revision');
    expect(preflight).toContain('integration_entitlement_source');
    expect(preflight).toContain("THEN 'plan'");
    expect(preflight).toContain("THEN 'addon'");
    expect(preflight).toContain('next_payment_date');
    expect(preflight).not.toContain("plan.status = 'active'");
    expect(preflight).not.toContain('integration_plan.status');
    expect(preflight).toContain('plan.deleted_at IS NULL');
    expect(preflight).toContain('next_payment_date > clock_timestamp()');
    expect(preflight).toContain('event.expires_at > clock_timestamp()');
    expect(preflight).toContain('delivery.expires_at > clock_timestamp()');
    expect(preflight).toContain(
      'webhook.channel_id = ANY(event.routing_channel_ids)'
    );
    expect(preflight).toContain('jsonb_array_elements(event.target_snapshot)');
    expect(preflight).toContain("captured_target ->> 'webhook_id'");
    expect(preflight).toContain("captured_target ->> 'channel_id'");
    expect(preflight).toContain('channel.deleted_at IS NULL');
    expect(preflight).toContain('FOR UPDATE OF delivery');
    expect(preflight).toContain('clock_timestamp');

    const leaseRenewal = collectSqlParts(
      database.execute.mock.calls[2]?.[0]
    ).join(' ');
    expect(leaseRenewal).toContain('lease_expires_at');
    expect(leaseRenewal).toContain('clock_timestamp');
    expect(leaseRenewal).toContain("INTERVAL '1 millisecond'");
    expect(leaseRenewal).toContain('60000');
    expect(leaseRenewal).toContain('leased');
    expect(leaseRenewal).toContain('lease-1');
    expect(leaseRenewal).toContain('RETURNING');
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook delivery admitted',
      expect.objectContaining({
        account_id: 'account-1',
        revision: '7',
        source: 'addon',
        event_id: 'event-1',
      })
    );
  });

  it('returns lost and rolls back the attempt when fenced lease renewal loses ownership', async () => {
    const database = createTransactionDb([
      { rows: [preparationRow] },
      { rows: [] },
      { rows: [] },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.prepareAttempt({
        claim: { deliveryId: 'delivery-1', leaseToken: 'stale-lease' },
        attemptId: 'attempt-1',
        leaseDurationMs: 60_000,
        now: new Date('2026-07-10T12:00:00.000Z'),
      })
    ).resolves.toEqual({ kind: 'lost', deliveryId: 'delivery-1' });

    const leaseRenewal = collectSqlParts(
      database.execute.mock.calls[2]?.[0]
    ).join(' ');
    expect(leaseRenewal).toContain('stale-lease');
    expect(leaseRenewal).toContain('leased');
    expect(leaseRenewal).toContain('RETURNING');
    expect(database.rolledBack).toHaveBeenCalledTimes(1);
  });

  it('persists a suppressed attempt when config version changed before HTTP', async () => {
    const database = createTransactionDb([
      {
        rows: [
          {
            ...preparationRow,
            webhook_config_version: 4,
          },
        ],
      },
      { rows: [] },
      {
        rows: [{ outbound_webhook_delivery_id: 'delivery-1' }],
      },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.prepareAttempt({
        claim: { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
        attemptId: 'attempt-1',
        leaseDurationMs: 60_000,
        now: new Date('2026-07-10T12:00:00.000Z'),
      })
    ).resolves.toEqual({
      kind: 'suppressed',
      deliveryId: 'delivery-1',
      reason: 'config_version_changed',
    });

    const insertAttempt = collectSqlParts(
      database.execute.mock.calls[1]?.[0]
    ).join(' ');
    const suppressDelivery = collectSqlParts(
      database.execute.mock.calls[2]?.[0]
    ).join(' ');
    expect(insertAttempt).toContain('suppressed');
    expect(insertAttempt).toContain('config_version_changed');
    expect(suppressDelivery).toContain('suppressed_at');
    expect(suppressDelivery).toContain('config_version_changed');
  });

  it.each([
    {
      field: 'channel_is_available',
      reason: 'channel_unavailable',
    },
    {
      field: 'channel_scope_matches',
      reason: 'channel_scope_mismatch',
    },
  ] as const)(
    'suppresses before HTTP when $reason',
    async ({ field, reason }) => {
      const database = createTransactionDb([
        {
          rows: [{ ...preparationRow, [field]: false }],
        },
        { rows: [] },
        {
          rows: [{ outbound_webhook_delivery_id: 'delivery-1' }],
        },
      ]);
      const store = new DrizzleOutboundWebhookDispatcherStore(
        database.db as never
      );

      await expect(
        store.prepareAttempt({
          claim: { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
          attemptId: 'attempt-1',
          leaseDurationMs: 60_000,
          now: new Date('2026-07-10T12:00:00.000Z'),
        })
      ).resolves.toEqual({
        kind: 'suppressed',
        deliveryId: 'delivery-1',
        reason,
      });

      const insertAttempt = collectSqlParts(
        database.execute.mock.calls[1]?.[0]
      ).join(' ');
      const suppressDelivery = collectSqlParts(
        database.execute.mock.calls[2]?.[0]
      ).join(' ');
      expect(insertAttempt).toContain(reason);
      expect(suppressDelivery).toContain(reason);
    }
  );

  it.each(['integration_is_eligible', 'integration_revision_matches'] as const)(
    'suppresses stale Integration work before HTTP when %s is false',
    async (field) => {
      const database = createTransactionDb([
        { rows: [{ ...preparationRow, [field]: false }] },
        { rows: [] },
        { rows: [{ outbound_webhook_delivery_id: 'delivery-1' }] },
      ]);
      const store = new DrizzleOutboundWebhookDispatcherStore(
        database.db as never
      );

      await expect(
        store.prepareAttempt({
          claim: { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
          attemptId: 'attempt-1',
          leaseDurationMs: 60_000,
          now: new Date('2026-07-10T12:00:00.000Z'),
        })
      ).resolves.toEqual({
        kind: 'suppressed',
        deliveryId: 'delivery-1',
        reason: 'integration_entitlement_missing',
      });
    }
  );

  it('logs the current grant source and event id when an old revision is suppressed', async () => {
    const auditLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const database = createTransactionDb([
      {
        rows: [{ ...preparationRow, integration_revision_matches: false }],
      },
      { rows: [] },
      { rows: [{ outbound_webhook_delivery_id: 'delivery-1' }] },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await store.prepareAttempt({
      claim: { deliveryId: 'delivery-1', leaseToken: 'lease-1' },
      attemptId: 'attempt-1',
      leaseDurationMs: 60_000,
      now: new Date('2026-07-10T12:00:00.000Z'),
    });

    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook delivery suppressed',
      expect.objectContaining({
        account_id: 'account-1',
        revision: '7',
        source: 'addon',
        event_id: 'event-1',
        reason: 'integration_entitlement_missing',
      })
    );
  });

  it('schedules a retry from the PostgreSQL clock instead of the pod clock', async () => {
    const database = createTransactionDb([
      {
        rows: [
          {
            outbound_webhook_id: 'webhook-1',
            account_id: 'account-1',
            webhook_status: 'active',
            webhook_config_version: 3,
            consecutive_dead_deliveries: 0,
            is_test: false,
            redelivery_of_delivery_id: null,
            attempt_finished_at: null,
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.completeAttempt({
        deliveryId: 'delivery-1',
        leaseToken: 'lease-1',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        configVersion: 3,
        deliveryStatus: 'retrying',
        attemptOutcome: 'http_error',
        finishedAt: new Date('2026-07-10T12:00:00.000Z'),
        retryDelayMs: 90_000,
        httpStatus: 429,
        errorCode: 'http_429',
        errorMessage: 'HTTP 429',
        responseBody: '',
        durationMs: 20,
        retryAfterMs: 90_000,
        suspendImmediately: false,
        affectsEndpointHealth: true,
      })
    ).resolves.toEqual({ applied: true, suspension: null });

    const deliveryUpdate = collectSqlParts(
      database.execute.mock.calls[2]?.[0]
    ).join(' ');
    expect(deliveryUpdate).toContain('next_attempt_at = clock_timestamp()');
    expect(deliveryUpdate).toContain("INTERVAL '1 millisecond'");
    expect(deliveryUpdate).toContain('90000');
    expect(deliveryUpdate).not.toContain('2026-07-10T12:01:30.000Z');
  });

  it('suspends and suppresses pending rows after the fifth logical live death', async () => {
    const database = createTransactionDb([
      {
        rows: [
          {
            outbound_webhook_id: 'webhook-1',
            account_id: 'account-1',
            webhook_status: 'active',
            webhook_config_version: 3,
            consecutive_dead_deliveries: 4,
            is_test: false,
            redelivery_of_delivery_id: null,
            attempt_finished_at: null,
          },
        ],
      },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const store = new DrizzleOutboundWebhookDispatcherStore(
      database.db as never
    );

    await expect(
      store.completeAttempt({
        deliveryId: 'delivery-1',
        leaseToken: 'lease-1',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        configVersion: 3,
        deliveryStatus: 'dead',
        attemptOutcome: 'http_error',
        finishedAt: new Date('2026-07-10T12:00:00.000Z'),
        httpStatus: 400,
        errorCode: 'http_400',
        errorMessage: 'HTTP 400',
        responseBody: '',
        durationMs: 20,
        retryAfterMs: null,
        suspendImmediately: false,
        affectsEndpointHealth: true,
      })
    ).resolves.toEqual({
      applied: true,
      suspension: {
        webhookId: 'webhook-1',
        accountId: 'account-1',
        reason: 'consecutive_dead_deliveries',
      },
    });

    const endpointUpdate = collectSqlParts(
      database.execute.mock.calls[3]?.[0]
    ).join(' ');
    const pendingSuppression = collectSqlParts(
      database.execute.mock.calls[4]?.[0]
    ).join(' ');
    expect(endpointUpdate).toContain('consecutive_dead_deliveries');
    expect(endpointUpdate).toContain('suspended');
    expect(endpointUpdate).toContain('consecutive_dead_deliveries');
    expect(pendingSuppression).toContain('pending');
    expect(pendingSuppression).toContain('retrying');
    expect(pendingSuppression).toContain('suppressed');
  });
});
