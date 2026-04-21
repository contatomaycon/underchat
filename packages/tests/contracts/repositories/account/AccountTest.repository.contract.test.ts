import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { AccountTestRepository } from '@core/repositories/account/AccountTest.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('AccountTestRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findExistingTest returns true when any duplicate exists', async () => {
    const repository = new AccountTestRepository(
      {
        insert: jest.fn(),
      } as never,
      {
        query: {
          accountTest: {
            findFirst: jest.fn(async () => ({ account_test_id: 'test-1' })),
          },
        },
      } as never
    );

    await expect(
      repository.findExistingTest({
        documentC: 'doc',
        phoneC: 'phone',
        emailC: 'email',
      })
    ).resolves.toBe(true);
  });

  it('findExistingTestByPhone and findExistingTestByEmail return false when not found', async () => {
    const repository = new AccountTestRepository(
      {
        insert: jest.fn(),
      } as never,
      {
        query: {
          accountTest: {
            findFirst: jest.fn(async () => null),
          },
        },
      } as never
    );

    await expect(repository.findExistingTestByPhone('phone')).resolves.toBe(
      false
    );
    await expect(repository.findExistingTestByEmail('email')).resolves.toBe(
      false
    );
  });

  it('createAccountTest inserts data and returns generated id', async () => {
    const values = jest.fn(async () => undefined);
    const insert = jest.fn(() => ({
      values,
    }));
    const uuidMock = randomUUID as unknown as jest.Mock;
    uuidMock.mockReturnValue('test-id-1');

    const repository = new AccountTestRepository(
      {
        insert,
      } as never,
      {
        query: {
          accountTest: {
            findFirst: jest.fn(),
          },
        },
      } as never
    );

    await expect(
      repository.createAccountTest({
        document: 'doc',
        documentC: 'doc-c',
        phone: 'phone',
        phoneC: 'phone-c',
        email: 'email',
        emailC: 'email-c',
      })
    ).resolves.toBe('test-id-1');

    expect(values).toHaveBeenCalledTimes(1);
    const payload = (values as jest.Mock).mock.calls[0]?.[0];
    expect(payload.account_test_id).toBe('test-id-1');
    expect(payload.document).toBe('doc');
    expect(payload.document_c).toBe('doc-c');
    expect(payload.phone).toBe('phone');
    expect(payload.phone_c).toBe('phone-c');
    expect(payload.email).toBe('email');
    expect(payload.email_c).toBe('email-c');
    expect(payload.created_at).toEqual(expect.any(String));
    expect(payload.updated_at).toBe(payload.created_at);
  });
});
