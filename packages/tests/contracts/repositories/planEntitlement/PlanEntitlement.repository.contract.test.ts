import 'reflect-metadata';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';

describe('PlanEntitlementRepository', () => {
  it('resolves current plan and addon grants in one revision-reconciling statement', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    let executeCount = 0;
    const execute = jest.fn(async (query: SQL) => {
      executeCount += 1;
      generatedSql = dialect.sqlToQuery(query).sql;
      if (executeCount < 3) return { rows: [] };
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: true,
            revision: 12n,
            valid_until: new Date('2099-01-01T00:00:00.000Z'),
            plan_is_active: true,
            source: 'addon',
          },
        ],
      };
    });
    const database = {
      execute,
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    };
    const repository = new PlanEntitlementRepository(database as never);

    await expect(
      repository.resolveEntitlement(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration
      )
    ).resolves.toEqual({
      accountId: '11111111-1111-4111-8111-111111111111',
      planProductId: EPlanProduct.integration,
      allowed: true,
      revision: '12',
      validUntil: '2099-01-01T00:00:00.000Z',
      planIsActive: true,
      source: 'addon',
    });

    expect(generatedSql).toContain('pa.updated_at DESC NULLS LAST');
    expect(generatedSql).toContain(
      'pcsa.cancellation_date >= lp.last_payment_date'
    );
    expect(generatedSql).toContain(
      'ON CONFLICT (account_id, plan_product_id) DO UPDATE'
    );
    expect(generatedSql).toContain('entitlement_revision.revision + 1');
    expect(generatedSql).not.toContain('p.status =');
  });

  it('detects whether activating a test plan can grant the product', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return { rows: [{ has_potential_grant: true }] };
    });
    const repository = new PlanEntitlementRepository({ execute } as never);

    await expect(
      repository.hasPotentialGrantAfterTestPlanActivation(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        EPlanProduct.integration
      )
    ).resolves.toBe(true);

    expect(generatedSql).toContain('p.status =');
    expect(generatedSql).toContain('pi.quantity > 0');
    expect(generatedSql).toContain('pcs.quantity > 0');
  });

  it('installs fan-out fences set-based after sorted advisory locks', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const ownerToken = '33333333-3333-4333-8333-333333333333';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: false,
            revision: 12n,
            valid_until: new Date('2099-01-01T00:00:00.000Z'),
            plan_is_active: true,
            source: null,
            deny_fence_token: ownerToken,
            requested_owner_token: ownerToken,
            underlying_allowed: true,
          },
        ],
      };
    });
    const database = {
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    };
    const repository = new PlanEntitlementRepository(database as never);

    await expect(
      repository.installDenyFences([
        {
          accountId: '11111111-1111-4111-8111-111111111111',
          planProductId: EPlanProduct.integration,
          ownerToken,
        },
      ])
    ).resolves.toEqual([
      {
        ownerToken,
        entitlement: {
          accountId: '11111111-1111-4111-8111-111111111111',
          planProductId: EPlanProduct.integration,
          allowed: false,
          revision: '12',
          validUntil: '2099-01-01T00:00:00.000Z',
          planIsActive: true,
          source: null,
        },
      },
    ]);
    expect(generatedSql).toContain('jsonb_to_recordset');
    expect(generatedSql).toContain('pg_advisory_xact_lock');
    expect(generatedSql).toContain('ORDER BY account_id, plan_product_id');
    expect(generatedSql).toContain('deny_fence_created_at');
  });

  it('explicitly adopts an active owner for a revocation retry under the same lock', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const activeOwnerToken = '44444444-4444-4444-8444-444444444444';
    const requestedOwnerToken = '33333333-3333-4333-8333-333333333333';
    const operationKey = 'payment-refund:payment-1';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: false,
            revision: 12n,
            valid_until: new Date('2099-01-01T00:00:00.000Z'),
            plan_is_active: true,
            source: null,
            deny_fence_token: activeOwnerToken,
            deny_fence_operation_key: operationKey,
            deny_fence_released_at: null,
            requested_owner_token: requestedOwnerToken,
            requested_operation_key: operationKey,
            underlying_allowed: true,
          },
        ],
      };
    });
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.installOrAdoptDenyFenceForRevocationRetry(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration,
        requestedOwnerToken,
        operationKey
      )
    ).resolves.toEqual({
      ownerToken: activeOwnerToken,
      adopted: true,
      releasePending: false,
      entitlement: expect.objectContaining({
        allowed: false,
        revision: '12',
      }),
    });
    expect(generatedSql).toContain('pg_advisory_xact_lock');
    expect(generatedSql).toMatch(
      /upserted\.deny_fence_operation_key,\s*upserted\.deny_fence_released_at,\s*resolved\.owner_token/
    );
  });

  it('adopts the active owner after the local revocation already made the underlying state denied', async () => {
    const activeOwnerToken = '44444444-4444-4444-8444-444444444444';
    const requestedOwnerToken = '33333333-3333-4333-8333-333333333333';
    const operationKey = 'payment-refund:payment-1';
    const execute = jest.fn(async () => ({
      rows: [
        {
          account_id: '11111111-1111-4111-8111-111111111111',
          plan_product_id: EPlanProduct.integration,
          allowed: false,
          revision: 13n,
          valid_until: null,
          plan_is_active: false,
          source: null,
          deny_fence_token: activeOwnerToken,
          deny_fence_operation_key: operationKey,
          deny_fence_released_at: null,
          requested_owner_token: requestedOwnerToken,
          requested_operation_key: operationKey,
          underlying_allowed: false,
        },
      ],
    }));
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.installOrAdoptDenyFenceForRevocationRetry(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration,
        requestedOwnerToken,
        operationKey
      )
    ).resolves.toEqual({
      ownerToken: activeOwnerToken,
      adopted: true,
      releasePending: false,
      entitlement: expect.objectContaining({
        allowed: false,
        revision: '13',
        planIsActive: false,
      }),
    });
  });

  it('preserves and returns a matching release-pending owner for owner-aware completion', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const operationKey = 'payment-refund:payment-1';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: false,
            revision: 13n,
            valid_until: null,
            plan_is_active: false,
            source: null,
            deny_fence_token: '44444444-4444-4444-8444-444444444444',
            deny_fence_operation_key: operationKey,
            deny_fence_released_at: '2026-07-11T13:00:00.000Z',
            requested_owner_token: '33333333-3333-4333-8333-333333333333',
            requested_operation_key: operationKey,
            underlying_allowed: false,
          },
        ],
      };
    });
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.installOrAdoptDenyFenceForRevocationRetry(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration,
        '33333333-3333-4333-8333-333333333333',
        operationKey
      )
    ).resolves.toEqual(
      expect.objectContaining({
        ownerToken: '44444444-4444-4444-8444-444444444444',
        adopted: true,
        releasePending: true,
      })
    );
    expect(generatedSql).toContain('THEN persisted.deny_fence_released_at');
    expect(generatedSql).not.toContain(
      'deny_fence_released_at = CASE WHEN persisted.deny_fence_operation_key'
    );
  });

  it('rejects adoption when the durable operation belongs to another payment', async () => {
    const execute = jest.fn(async () => ({
      rows: [
        {
          account_id: '11111111-1111-4111-8111-111111111111',
          plan_product_id: EPlanProduct.integration,
          allowed: false,
          revision: 13n,
          valid_until: null,
          plan_is_active: false,
          source: null,
          deny_fence_token: '44444444-4444-4444-8444-444444444444',
          deny_fence_operation_key: 'payment-refund:payment-2',
          deny_fence_released_at: null,
          requested_owner_token: '33333333-3333-4333-8333-333333333333',
          requested_operation_key: 'payment-refund:payment-1',
          underlying_allowed: false,
        },
      ],
    }));
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.installOrAdoptDenyFenceForRevocationRetry(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration,
        '33333333-3333-4333-8333-333333333333',
        'payment-refund:payment-1'
      )
    ).rejects.toThrow('plan_entitlement_deny_fence_operation_key_mismatch');
  });

  it('keeps ordinary fence installation exclusive when another owner is active', async () => {
    const execute = jest.fn(async () => ({
      rows: [
        {
          account_id: '11111111-1111-4111-8111-111111111111',
          plan_product_id: EPlanProduct.integration,
          allowed: false,
          revision: 12n,
          valid_until: new Date('2099-01-01T00:00:00.000Z'),
          plan_is_active: true,
          source: null,
          deny_fence_token: '44444444-4444-4444-8444-444444444444',
          requested_owner_token: '33333333-3333-4333-8333-333333333333',
          underlying_allowed: true,
        },
      ],
    }));
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.installDenyFences([
        {
          accountId: '11111111-1111-4111-8111-111111111111',
          planProductId: EPlanProduct.integration,
          ownerToken: '33333333-3333-4333-8333-333333333333',
        },
      ])
    ).rejects.toThrow('plan_entitlement_deny_fence_already_owned');
  });

  it('projects grants purchased on the payment being released', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return { rows: [{ projected_allowed: true }] };
    });
    const repository = new PlanEntitlementRepository({ execute } as never);

    await expect(
      repository.willGrantAfterPlanAssignment({
        accountId: '11111111-1111-4111-8111-111111111111',
        planId: '22222222-2222-4222-8222-222222222222',
        planProductId: EPlanProduct.integration,
        prospectiveLastPaymentDate: '2099-01-01T00:00:00.000Z',
        includeExistingAddons: false,
        prospectiveAccountPaymentId: '33333333-3333-4333-8333-333333333333',
      })
    ).resolves.toBe(true);

    expect(generatedSql).toContain('account_payment_cross_sell');
    expect(generatedSql).toContain('purchased.quantity > 0');
    expect(generatedSql).toContain('addon.quantity > 0');
    expect(generatedSql).toContain('addon.deleted_at IS NULL');
  });

  it('reconciles a batch with ordered locks and set-based source resolution', async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = jest.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql);
      if (statements.length < 4) return { rows: [] };
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: true,
            revision: 9n,
            valid_until: new Date('2099-01-01T00:00:00.000Z'),
            plan_is_active: true,
            source: 'plan',
          },
        ],
      };
    });
    const database = {
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    };
    const repository = new PlanEntitlementRepository(database as never);

    await expect(
      repository.reconcileEntitlements([
        {
          accountId: '11111111-1111-4111-8111-111111111111',
          planProductId: EPlanProduct.integration,
        },
      ])
    ).resolves.toEqual([
      {
        activeFenceOwnerToken: null,
        entitlement: expect.objectContaining({
          allowed: true,
          revision: '9',
          source: 'plan',
        }),
        releasedFenceOwnerToken: null,
        expiredFenceOwnerToken: null,
        staleFenceOwnerToken: null,
      },
    ]);

    expect(execute).toHaveBeenCalledTimes(4);
    expect(statements[0]).toContain('pg_advisory_xact_lock');
    expect(statements.join('\n')).toContain('jsonb_to_recordset');
    expect(statements[3]).toContain('LEFT JOIN LATERAL');
    expect(statements[3]).not.toContain('p.status =');
  });

  it('rejects inconsistent allowed/source rows instead of normalizing them', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            allowed: true,
            revision: 1n,
            valid_until: new Date('2099-01-01T00:00:00.000Z'),
            plan_is_active: true,
            source: null,
          },
        ],
      });
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.resolveEntitlement(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration
      )
    ).rejects.toThrow('plan_entitlement_resolution_returned_invalid_source');
  });

  it('renews durable fences with one owner-CAS heartbeat statement', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const ownerToken = '33333333-3333-4333-8333-333333333333';
    const execute = jest.fn(async (query: SQL) => {
      generatedSql = dialect.sqlToQuery(query).sql;
      return {
        rows: [
          {
            account_id: '11111111-1111-4111-8111-111111111111',
            plan_product_id: EPlanProduct.integration,
            owner_token: ownerToken,
          },
        ],
      };
    });
    const repository = new PlanEntitlementRepository({ execute } as never);

    await expect(
      repository.heartbeatDenyFences([
        {
          accountId: '11111111-1111-4111-8111-111111111111',
          planProductId: EPlanProduct.integration,
          ownerToken,
        },
      ])
    ).resolves.toEqual([
      {
        accountId: '11111111-1111-4111-8111-111111111111',
        planProductId: EPlanProduct.integration,
        ownerToken,
      },
    ]);

    expect(generatedSql).toContain('jsonb_to_recordset');
    expect(generatedSql).toContain(
      'SET deny_fence_created_at = clock_timestamp()'
    );
    expect(generatedSql).toContain(
      'persisted.deny_fence_token = requested.owner_token'
    );
    expect(generatedSql).toContain('persisted.deny_fence_released_at IS NULL');
  });

  it('releases orphan recovery only while the owner heartbeat is still stale', async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = jest.fn(async (query: SQL) => {
      statements.push(dialect.sqlToQuery(query).sql);
      if (statements.length === 2) return { rows: [{ released: true }] };
      if (statements.length === 3) {
        return {
          rows: [
            {
              account_id: '11111111-1111-4111-8111-111111111111',
              plan_product_id: EPlanProduct.integration,
              allowed: true,
              revision: 4n,
              valid_until: new Date('2099-01-01T00:00:00.000Z'),
              plan_is_active: true,
              source: 'plan',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const repository = new PlanEntitlementRepository({
      transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
        callback({ execute })
      ),
    } as never);

    await expect(
      repository.releaseStaleDenyFence(
        '11111111-1111-4111-8111-111111111111',
        EPlanProduct.integration,
        '33333333-3333-4333-8333-333333333333'
      )
    ).resolves.toEqual({
      released: true,
      entitlement: expect.objectContaining({ allowed: true, revision: '4' }),
    });
    expect(statements[1]).toContain('deny_fence_released_at IS NULL');
    expect(statements[1]).toContain(
      'deny_fence_created_at <= clock_timestamp()'
    );
  });
});
