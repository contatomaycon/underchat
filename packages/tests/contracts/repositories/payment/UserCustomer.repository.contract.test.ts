import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { UserCustomerRepository } from '@core/repositories/payment/UserCustomer.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('UserCustomerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (randomUUID as unknown as jest.Mock).mockReturnValue('user-customer-id');
  });

  it('returns null when getUserCustomerByUserId does not find data', async () => {
    const dbRw = {
      query: {
        userCustomer: {
          findFirst: jest.fn(async () => null),
        },
      },
    };

    const repository = new UserCustomerRepository(dbRw as never);

    await expect(
      repository.getUserCustomerByUserId('user-1')
    ).resolves.toBeNull();
  });

  it('returns mapped user customer when getUserCustomerByUserId finds row', async () => {
    const dbRw = {
      query: {
        userCustomer: {
          findFirst: jest.fn(async () => ({
            user_customer_id: 'uc-1',
            user_customer: 'cust-1',
          })),
        },
      },
    };

    const repository = new UserCustomerRepository(dbRw as never);

    await expect(repository.getUserCustomerByUserId('user-1')).resolves.toEqual(
      {
        user_customer_id: 'uc-1',
        user_customer: 'cust-1',
      }
    );
  });

  it('createUserCustomer returns inserted row when insert succeeds', async () => {
    const returning = jest.fn(async () => [
      {
        user_customer_id: 'uc-inserted',
        user_customer: 'cust-1',
      },
    ]);
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));

    const dbRw = {
      insert,
      query: {
        userCustomer: {
          findFirst: jest.fn(),
        },
      },
    };

    const repository = new UserCustomerRepository(dbRw as never);

    await expect(
      repository.createUserCustomer('user-1', 'cust-1')
    ).resolves.toEqual({
      user_customer_id: 'uc-inserted',
      user_customer: 'cust-1',
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_customer_id: 'user-customer-id',
        user_id: 'user-1',
        user_customer: 'cust-1',
      })
    );
  });

  it('createUserCustomer returns existing row after insert conflict', async () => {
    const returning = jest.fn(async () => []);
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));

    const dbRw = {
      insert,
      query: {
        userCustomer: {
          findFirst: jest.fn(async () => ({
            user_customer_id: 'uc-existing',
            user_customer: 'cust-existing',
          })),
        },
      },
    };

    const repository = new UserCustomerRepository(dbRw as never);

    await expect(
      repository.createUserCustomer('user-1', 'cust-1')
    ).resolves.toEqual({
      user_customer_id: 'uc-existing',
      user_customer: 'cust-existing',
    });
  });

  it('createUserCustomer throws when conflict occurs and existing row is missing', async () => {
    const returning = jest.fn(async () => []);
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));

    const dbRw = {
      insert,
      query: {
        userCustomer: {
          findFirst: jest.fn(async () => null),
        },
      },
    };

    const repository = new UserCustomerRepository(dbRw as never);

    await expect(
      repository.createUserCustomer('user-1', 'cust-1')
    ).rejects.toThrow('User customer not found after insert conflict');
  });

  it('updateUserCustomerByUserId returns updated row', async () => {
    const returning = jest.fn(async () => [
      {
        user_customer_id: 'uc-1',
        user_customer: 'cust-updated',
      },
    ]);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));

    const repository = new UserCustomerRepository({ update } as never);

    await expect(
      repository.updateUserCustomerByUserId('user-1', 'cust-updated')
    ).resolves.toEqual({
      user_customer_id: 'uc-1',
      user_customer: 'cust-updated',
    });
  });

  it('updateUserCustomerByUserId throws when no row is updated', async () => {
    const returning = jest.fn(async () => []);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const update = jest.fn(() => ({ set }));

    const repository = new UserCustomerRepository({ update } as never);

    await expect(
      repository.updateUserCustomerByUserId('user-1', 'cust-updated')
    ).rejects.toThrow('User customer not found');
  });
});
