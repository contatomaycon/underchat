import 'reflect-metadata';
import { AccountViewerRepository } from '@core/repositories/account/AccountViewer.repository';

describe('AccountViewerRepository', () => {
  it('returns null when no account is found', async () => {
    const findMany = jest.fn(async () => []);
    const db = {
      query: {
        account: {
          findMany,
        },
      },
    };
    const repository = new AccountViewerRepository(db as never);

    await expect(repository.viewAccounts('acc-1')).resolves.toBeNull();
  });

  it('returns account with active plan information when renewal date is in the future', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const findMany = jest.fn(async () => [
      {
        account_id: 'acc-1',
        name: 'Account 1',
        generate_invoice: true,
        created_at: '2026-01-01T00:00:00.000Z',
        aac: {
          account_status_id: 'active',
          name: 'Active',
        },
        apc: [
          {
            plan_account_id: 'plan-1',
            next_payment_date: futureDate,
            recurring_payment: true,
            ppl: {
              plan_id: 'plan-basic',
              name: 'Basic',
            },
            bpl: {
              billing_period_id: 'monthly',
              name: 'monthly',
            },
          },
        ],
      },
    ]);
    const db = {
      query: {
        account: {
          findMany,
        },
      },
    };
    const repository = new AccountViewerRepository(db as never);

    await expect(repository.viewAccounts('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
      name: 'Account 1',
      account_status: {
        account_status_id: 'active',
        name: 'Active',
      },
      plan: {
        plan_id: 'plan-basic',
        name: 'Basic',
        recurring_payment: true,
        billing_period: 'monthly',
      },
      generate_invoice: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns account with null plan when no active plan exists', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const findMany = jest.fn(async () => [
      {
        account_id: 'acc-1',
        name: 'Account 1',
        generate_invoice: null,
        created_at: '2026-01-01T00:00:00.000Z',
        aac: null,
        apc: [
          {
            plan_account_id: 'plan-1',
            next_payment_date: pastDate,
            recurring_payment: true,
            ppl: {
              plan_id: 'plan-basic',
              name: 'Basic',
            },
            bpl: {
              billing_period_id: 'weekly',
              name: 'weekly',
            },
          },
        ],
      },
    ]);
    const db = {
      query: {
        account: {
          findMany,
        },
      },
    };
    const repository = new AccountViewerRepository(db as never);

    await expect(repository.viewAccounts('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
      name: 'Account 1',
      account_status: null,
      plan: null,
      generate_invoice: null,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns active plan with null billing_period when source value is not monthly/annual', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const findMany = jest.fn(async () => [
      {
        account_id: 'acc-1',
        name: 'Account 1',
        generate_invoice: false,
        created_at: '2026-01-01T00:00:00.000Z',
        aac: {
          account_status_id: 'active',
          name: 'Active',
        },
        apc: [
          {
            plan_account_id: 'plan-1',
            next_payment_date: futureDate,
            recurring_payment: false,
            ppl: {
              plan_id: 'plan-basic',
              name: 'Basic',
            },
            bpl: {
              billing_period_id: 'weekly',
              name: 'weekly',
            },
          },
        ],
      },
    ]);
    const db = {
      query: {
        account: {
          findMany,
        },
      },
    };
    const repository = new AccountViewerRepository(db as never);

    await expect(repository.viewAccounts('acc-1')).resolves.toEqual({
      account_id: 'acc-1',
      name: 'Account 1',
      account_status: {
        account_status_id: 'active',
        name: 'Active',
      },
      plan: {
        plan_id: 'plan-basic',
        name: 'Basic',
        recurring_payment: false,
        billing_period: null,
      },
      generate_invoice: false,
      created_at: '2026-01-01T00:00:00.000Z',
    });
  });
});
