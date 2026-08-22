import 'reflect-metadata';
import { PlanReleaseRepository } from '@core/repositories/plan/PlanRelease.repository';
import { EAccountPaymentReleaseStatus } from '@core/common/enums/EAccountPaymentReleaseStatus';
import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

describe('PlanReleaseRepository', () => {
  function buildRepository(dbRw?: any, dbRo?: any) {
    return new PlanReleaseRepository(
      (dbRw ?? {}) as never,
      (dbRo ?? {}) as never
    );
  }

  it('findAccountPaymentByBilling and findAccountPaymentById return rows or null', async () => {
    const repository = buildRepository({
      query: {
        accountPayment: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ account_payment_id: 'ap-1' })
            .mockResolvedValueOnce(null),
        },
      },
    });

    await expect(
      repository.findAccountPaymentByBilling('billing-1')
    ).resolves.toEqual({ account_payment_id: 'ap-1' });
    await expect(repository.findAccountPaymentById('ap-1')).resolves.toBeNull();
  });

  it('reads the release projection from primary with deterministic ordering', async () => {
    const findFirst = jest.fn<Promise<any>, [any]>(async () => ({
      plan_account_id: 'pa-1',
      plan_id: 'plan-1',
    }));
    const repository = buildRepository({
      query: { planAccount: { findFirst } },
    });

    await repository.findPlanAccountByAccountId('acc-1');
    const orderBy = findFirst.mock.calls[0]?.[0].orderBy;
    expect(
      orderBy(
        {
          updated_at: 'updated_at',
          created_at: 'created_at',
          plan_account_id: 'plan_account_id',
        },
        { desc: (value: string) => `desc:${value}` }
      )
    ).toEqual(['desc:updated_at', 'desc:created_at', 'desc:plan_account_id']);
  });

  it('upsertPlanAccount updates existing plan account or creates a new one', async () => {
    const repository = buildRepository();
    (repository as any).findPlanAccountByAccountIdTx = jest
      .fn()
      .mockResolvedValueOnce({ plan_account_id: 'existing-1' })
      .mockResolvedValueOnce(null);
    (repository as any).updatePlanAccount = jest.fn(async () => undefined);
    (repository as any).createPlanAccount = jest.fn(async () => undefined);

    await expect(
      repository.upsertPlanAccount({} as never, {
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentId: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-20',
        nextPaymentDate: '2026-05-20',
        value: '100',
      })
    ).resolves.toBeUndefined();
    await expect(
      repository.upsertPlanAccount({} as never, {
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentId: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-20',
        nextPaymentDate: '2026-05-20',
        value: '100',
      })
    ).resolves.toBeUndefined();

    expect((repository as any).updatePlanAccount).toHaveBeenCalledTimes(1);
    expect((repository as any).createPlanAccount).toHaveBeenCalledTimes(1);
  });

  it('processPaymentAndReleasePlan releases plan and appends addons when requested', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              for: jest.fn(async () => [
                {
                  release_status: 'pending',
                  payment_status_id: 'pending',
                  payment_status_observed_at: null,
                  payment_status_event_id: null,
                },
              ]),
            })),
          })),
        })),
      })),
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();
    (repository as any).updateAccountStatusToActive = jest.fn(
      async () => undefined
    );
    (repository as any).appendPlanCrossSellAccount = jest.fn(
      async () => undefined
    );
    (repository as any).replacePlanCrossSellAccount = jest.fn(
      async () => undefined
    );

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'ap-1',
        paymentStatusId: 'paid',
        paymentDate: '2026-04-21',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentIdForPlan: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-21',
        nextPaymentDate: '2026-05-21',
        value: '100',
        shouldReleasePlan: true,
        replaceExistingAddons: false,
      })
    ).resolves.toBe(true);

    expect(repository.upsertPlanAccount).toHaveBeenCalledTimes(1);
    expect(
      (repository as any).appendPlanCrossSellAccount
    ).toHaveBeenCalledTimes(1);
    expect(
      (repository as any).replacePlanCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('processPaymentAndReleasePlan skips release when already processed and handles addon-only', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              for: jest.fn(async () => [
                {
                  release_status: EAccountPaymentReleaseStatus.processed,
                  payment_status_id: 'paid',
                  payment_status_observed_at: null,
                  payment_status_event_id: null,
                },
              ]),
            })),
          })),
        })),
      })),
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();
    (repository as any).appendPlanCrossSellAccount = jest.fn(
      async () => undefined
    );

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'ap-1',
        paymentStatusId: 'paid',
        paymentDate: '2026-04-21',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentIdForPlan: 'ap-1',
        recurringPayment: true,
        billingPeriodId: null,
        lastPaymentDate: '2026-04-21',
        nextPaymentDate: '2026-05-21',
        value: '100',
        shouldReleasePlan: true,
        isAddonOnly: true,
      })
    ).resolves.toBe(true);

    expect(repository.upsertPlanAccount).not.toHaveBeenCalled();
    expect(
      (repository as any).appendPlanCrossSellAccount
    ).not.toHaveBeenCalled();
  });

  it('mark release status methods execute update chain', async () => {
    const dbRw = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(),
        })),
      })),
    };
    const repository = buildRepository(dbRw);

    await expect(
      repository.markAccountPaymentReleaseFailed('ap-1', 'error')
    ).resolves.toBeUndefined();
    await expect(
      repository.markAccountPaymentReleaseProcessed('ap-1', '2026-04-21')
    ).resolves.toBeUndefined();
    expect(dbRw.update).toHaveBeenCalledTimes(2);
  });

  it('soft-deletes existing add-on assignments with one set-based UPDATE', async () => {
    const where = jest.fn(async () => undefined);
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));
    const repository = buildRepository();

    await expect(
      (repository as any).softDeletePlanCrossSellAccounts({ update }, [
        { plan_cross_sell_account_id: '11111111-1111-4111-8111-111111111111' },
        { plan_cross_sell_account_id: '22222222-2222-4222-8222-222222222222' },
      ])
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('records the originating payment on materialized add-on assignments', async () => {
    const values = jest.fn(async () => undefined);
    const repository = buildRepository();

    await (repository as any).createPlanCrossSellAccounts(
      { insert: jest.fn(() => ({ values })) },
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      [
        {
          plan_cross_sell_id: '33333333-3333-4333-8333-333333333333',
        },
      ]
    );

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        account_id: '11111111-1111-4111-8111-111111111111',
        account_payment_id: '22222222-2222-4222-8222-222222222222',
        plan_cross_sell_id: '33333333-3333-4333-8333-333333333333',
      }),
    ]);
  });

  it('does not materialize zero-quantity purchased add-ons', async () => {
    const dialect = new PgDialect();
    let generatedSql = '';
    const repository = buildRepository();

    await (repository as any).findAccountPaymentCrossSells(
      {
        query: {
          accountPaymentCrossSell: {
            findMany: jest.fn(async (query: { where: SQL }) => {
              generatedSql = dialect.sqlToQuery(query.where).sql;
              return [];
            }),
          },
        },
      },
      '22222222-2222-4222-8222-222222222222'
    );

    expect(generatedSql).toContain('"account_payment_cross_sell"."quantity" >');
  });

  it('gives revoking states fail-closed precedence at equal event timestamps', () => {
    const repository = buildRepository();
    const compare = (repository as any).isIncomingStatusObservationNewer;
    const observedAt = '2026-07-11T12:00:00.000Z';

    expect(
      compare({
        currentObservedAt: observedAt,
        currentEventId: 'evt-refund',
        currentStatusId: EPaymentStatus.refunded,
        incomingObservedAt: observedAt,
        incomingEventId: 'zzz-confirmed',
        incomingStatusId: EPaymentStatus.confirmed,
      })
    ).toBe(false);
    expect(
      compare({
        currentObservedAt: observedAt,
        currentEventId: 'evt-confirmed',
        currentStatusId: EPaymentStatus.confirmed,
        incomingObservedAt: observedAt,
        incomingEventId: 'aaa-refund',
        incomingStatusId: EPaymentStatus.refunded,
      })
    ).toBe(true);
    expect(
      compare({
        currentObservedAt: observedAt,
        currentEventId: 'zzz-pending',
        currentStatusId: EPaymentStatus.pending,
        incomingObservedAt: observedAt,
        incomingEventId: 'aaa-confirmed',
        incomingStatusId: EPaymentStatus.confirmed,
      })
    ).toBe(true);
    expect(
      compare({
        currentObservedAt: observedAt,
        currentEventId: 'aaa-confirmed',
        currentStatusId: EPaymentStatus.confirmed,
        incomingObservedAt: observedAt,
        incomingEventId: 'zzz-pending',
        incomingStatusId: EPaymentStatus.pending,
      })
    ).toBe(false);
  });

  it('does not let a stale local success overwrite a newer revoking event', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({
              for: jest.fn(async () => [
                {
                  release_status: EAccountPaymentReleaseStatus.pending,
                  payment_status_id: EPaymentStatus.refunded,
                  payment_status_observed_at: '2026-07-11T12:00:00.000Z',
                  payment_status_event_id: 'evt-refund',
                },
              ]),
            })),
          })),
        })),
      })),
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'ap-1',
        paymentStatusId: EPaymentStatus.confirmed,
        paymentDate: '2026-07-11T11:00:00.000Z',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'p-1',
        accountPaymentIdForPlan: 'ap-1',
        recurringPayment: false,
        billingPeriodId: null,
        lastPaymentDate: '2026-07-11T11:00:00.000Z',
        nextPaymentDate: '2026-08-11T11:00:00.000Z',
        value: '100',
        shouldReleasePlan: true,
      })
    ).resolves.toBe(false);

    expect(repository.updateAccountPaymentStatus).not.toHaveBeenCalled();
    expect(repository.upsertPlanAccount).not.toHaveBeenCalled();
  });

  it('updates only the historical payment when its reversal races a newer plan', async () => {
    let selectCount = 0;
    const tx = {
      select: jest.fn(() => {
        selectCount += 1;
        const rows =
          selectCount === 1
            ? [
                {
                  release_status: EAccountPaymentReleaseStatus.pending,
                  payment_status_id: EPaymentStatus.refunded,
                  payment_status_observed_at: '2026-07-11T12:00:00.000Z',
                  payment_status_event_id: 'evt-refund',
                },
              ]
            : [{ account_payment_id: 'newer-payment' }];
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                  for: jest.fn(async () => rows),
                })),
              })),
              limit: jest.fn(() => ({
                for: jest.fn(async () => rows),
              })),
            })),
          })),
        };
      }),
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();
    jest.spyOn(repository, 'upsertPlanAccount').mockResolvedValue();

    await expect(
      repository.processPaymentAndReleasePlan({
        accountPaymentId: 'old-payment',
        paymentStatusId: EPaymentStatus.confirmed,
        paymentDate: '2026-07-12T12:00:00.000Z',
        pixTransaction: null,
        accountId: 'a-1',
        planId: 'old-plan',
        accountPaymentIdForPlan: 'old-payment',
        recurringPayment: false,
        billingPeriodId: null,
        lastPaymentDate: '2026-07-12T12:00:00.000Z',
        nextPaymentDate: '2026-08-12T12:00:00.000Z',
        value: '100',
        shouldReleasePlan: true,
        allowFinancialReversal: true,
        statusObservedAt: '2026-07-12T12:00:00.000Z',
        statusEventId: 'evt-reversal',
        releaseStatus: EAccountPaymentReleaseStatus.processed,
      })
    ).resolves.toBe(false);

    expect(repository.updateAccountPaymentStatus).toHaveBeenCalledTimes(1);
    expect(repository.upsertPlanAccount).not.toHaveBeenCalled();
  });

  it('requires a fence before a final payment-source revocation can deny Integration', async () => {
    let selectCount = 0;
    const update = jest.fn();
    const lockedQuery = (rows: unknown[]) => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({ for: jest.fn(async () => rows) })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({ for: jest.fn(async () => rows) })),
          })),
        })),
      })),
    });
    const tx = {
      select: jest.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return lockedQuery([
            {
              payment_status_id: EPaymentStatus.confirmed,
              payment_status_observed_at: null,
              payment_status_event_id: null,
            },
          ]);
        }
        if (selectCount === 2) {
          return lockedQuery([{ plan_account_id: 'plan-account-1' }]);
        }
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(async () => [
                {
                  allowed: true,
                  deny_fence_token: null,
                  deny_fence_created_at: null,
                  deny_fence_released_at: null,
                },
              ]),
            })),
          })),
        };
      }),
      execute: jest.fn(async () => ({
        rows: [{ projected_allowed: false }],
      })),
      update,
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();

    await expect(
      repository.processPaymentRevocation({
        accountPaymentId: 'payment-1',
        accountId: 'account-1',
        paymentStatusId: EPaymentStatus.refunded,
        paymentDate: '2026-07-11T12:00:00.000Z',
        pixTransaction: null,
        planProductId: 'product-1',
        statusObservedAt: '2026-07-11T13:00:00.000Z',
        statusEventId: 'evt-refund',
      })
    ).resolves.toEqual({
      applied: false,
      requiresDenyFence: true,
      ignoredAsStale: false,
    });

    expect(update).not.toHaveBeenCalled();
    expect(repository.updateAccountPaymentStatus).not.toHaveBeenCalled();
  });

  it('applies a final revocation only with the exact durable fence owner', async () => {
    let selectCount = 0;
    const updateWhere = jest.fn(async () => undefined);
    const updateSet = jest.fn((_values: Record<string, unknown>) => ({
      where: updateWhere,
    }));
    const update = jest.fn(() => ({
      set: updateSet,
    }));
    const lockedQuery = (rows: unknown[]) => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({ for: jest.fn(async () => rows) })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({ for: jest.fn(async () => rows) })),
          })),
        })),
      })),
    });
    const tx = {
      select: jest.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return lockedQuery([
            {
              payment_status_id: EPaymentStatus.confirmed,
              payment_status_observed_at: null,
              payment_status_event_id: null,
            },
          ]);
        }
        if (selectCount === 2) {
          return lockedQuery([{ plan_account_id: 'plan-account-1' }]);
        }
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(async () => [
                {
                  allowed: true,
                  deny_fence_token: 'owner-1',
                  deny_fence_created_at: '2026-07-11T12:59:00.000Z',
                  deny_fence_released_at: null,
                },
              ]),
            })),
          })),
        };
      }),
      execute: jest.fn(async () => ({
        rows: [{ projected_allowed: false }],
      })),
      update,
    };
    const repository = buildRepository({
      transaction: jest.fn(async (callback) => callback(tx)),
    });
    const updateStatus = jest
      .spyOn(repository, 'updateAccountPaymentStatus')
      .mockResolvedValue();

    await expect(
      repository.processPaymentRevocation({
        accountPaymentId: 'payment-1',
        accountId: 'account-1',
        paymentStatusId: EPaymentStatus.refunded,
        paymentDate: '2026-07-11T12:00:00.000Z',
        pixTransaction: null,
        planProductId: 'product-1',
        denyFenceOwnerToken: 'owner-1',
        statusObservedAt: '2026-07-11T13:00:00.000Z',
        statusEventId: 'evt-refund',
      })
    ).resolves.toEqual({
      applied: true,
      requiresDenyFence: false,
      ignoredAsStale: false,
    });

    expect(updateStatus).toHaveBeenCalledWith(
      tx,
      'payment-1',
      EPaymentStatus.refunded,
      '2026-07-11T12:00:00.000Z',
      null,
      expect.objectContaining({
        releaseStatus: EAccountPaymentReleaseStatus.pending,
        statusObservedAt: '2026-07-11T13:00:00.000Z',
        statusEventId: 'evt-refund',
      })
    );
    expect(update).toHaveBeenCalledTimes(2);
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty('updated_at');
  });

  it('serializes two add-on payment revocations so the second requires a fence', async () => {
    const activePayments = new Set(['payment-1', 'payment-2']);
    let queue = Promise.resolve();
    const createPlanMutex = async (): Promise<() => void> => {
      const previous = queue;
      let release = (): void => undefined;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return release;
    };
    let transactionNumber = 0;
    const dbRw = {
      transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          transactionNumber += 1;
          const paymentId = `payment-${transactionNumber}`;
          let selectCount = 0;
          const planMutex: { release?: () => void } = {};
          let updateCount = 0;
          const lockedQuery = (rows: unknown[], lockPlan = false) => ({
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                limit: jest.fn(() => ({
                  for: jest.fn(async () => {
                    if (lockPlan) {
                      planMutex.release = await createPlanMutex();
                    }
                    return rows;
                  }),
                })),
                orderBy: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    for: jest.fn(async () => {
                      planMutex.release = await createPlanMutex();
                      return rows;
                    }),
                  })),
                })),
              })),
            })),
          });
          const tx = {
            select: jest.fn(() => {
              selectCount += 1;
              if (selectCount === 1) {
                return lockedQuery([
                  {
                    payment_status_id: EPaymentStatus.confirmed,
                    payment_status_observed_at: null,
                    payment_status_event_id: null,
                  },
                ]);
              }
              if (selectCount === 2) {
                return lockedQuery(
                  [{ plan_account_id: 'shared-plan-account' }],
                  true
                );
              }
              return {
                from: jest.fn(() => ({
                  where: jest.fn(() => ({
                    limit: jest.fn(async () => [
                      {
                        allowed: true,
                        deny_fence_token: null,
                        deny_fence_created_at: null,
                        deny_fence_released_at: null,
                      },
                    ]),
                  })),
                })),
              };
            }),
            execute: jest.fn(async () => ({
              rows: [
                {
                  projected_allowed: Array.from(activePayments).some(
                    (activePaymentId) => activePaymentId !== paymentId
                  ),
                },
              ],
            })),
            update: jest.fn(() => {
              updateCount += 1;
              return {
                set: jest.fn(() => ({
                  where: jest.fn(async () => {
                    if (updateCount === 2) activePayments.delete(paymentId);
                  }),
                })),
              };
            }),
          };
          try {
            return await callback(tx);
          } finally {
            planMutex.release?.();
          }
        }
      ),
    };
    const repository = buildRepository(dbRw);
    jest.spyOn(repository, 'updateAccountPaymentStatus').mockResolvedValue();

    const results = await Promise.all([
      repository.processPaymentRevocation({
        accountPaymentId: 'payment-1',
        accountId: 'account-1',
        paymentStatusId: EPaymentStatus.refunded,
        paymentDate: null,
        pixTransaction: null,
        planProductId: 'product-1',
        statusObservedAt: '2026-07-11T13:00:00.000Z',
        statusEventId: 'evt-refund-1',
      }),
      repository.processPaymentRevocation({
        accountPaymentId: 'payment-2',
        accountId: 'account-1',
        paymentStatusId: EPaymentStatus.refunded,
        paymentDate: null,
        pixTransaction: null,
        planProductId: 'product-1',
        statusObservedAt: '2026-07-11T13:00:01.000Z',
        statusEventId: 'evt-refund-2',
      }),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        {
          applied: true,
          requiresDenyFence: false,
          ignoredAsStale: false,
        },
        {
          applied: false,
          requiresDenyFence: true,
          ignoredAsStale: false,
        },
      ])
    );
    expect(activePayments.size).toBe(1);
  });

  it('findPlan helpers and account invoice flag return expected values', async () => {
    const findAccount = jest
      .fn()
      .mockResolvedValueOnce({ generate_invoice: true })
      .mockResolvedValueOnce({ generate_invoice: null })
      .mockResolvedValueOnce(null);

    const repository = buildRepository(
      {
        query: {
          account: {
            findFirst: findAccount,
          },
        },
      },
      {
        query: {
          plan: {
            findFirst: jest
              .fn()
              .mockResolvedValueOnce({ name: 'Pro', description: 'desc' })
              .mockResolvedValueOnce({ is_test: true }),
          },
        },
      }
    );

    await expect(repository.findPlanById('p-1')).resolves.toEqual({
      name: 'Pro',
      description: 'desc',
    });
    await expect(repository.findPlanIsTestById('p-1')).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('a-1')
    ).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('a-2')
    ).resolves.toBe(true);
    await expect(
      repository.findAccountGenerateInvoiceById('missing-account')
    ).resolves.toBeNull();
  });
});
