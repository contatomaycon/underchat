import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TwoFactorCreatorRepository } from '@core/repositories/auth/TwoFactorCreator.repository';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('TwoFactorCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates two factor record and returns generated id', async () => {
    const values = jest.fn(async () => undefined);
    const insert = jest.fn(() => ({
      values,
    }));
    const repository = new TwoFactorCreatorRepository({
      insert,
    } as never);
    const uuidMock = randomUUID as unknown as jest.Mock;
    uuidMock.mockReturnValue('two-factor-1');

    await expect(
      repository.createTwoFactor({
        userId: 'user-1',
        phoneDdi: '55',
        phone: '11999999999',
        phonePartial: '***9999',
        phoneC: '11999999999c',
        email: 'mail@test.com',
        emailPartial: 'm***@test.com',
        emailC: 'mailc',
        code: '123456',
        token: 'token-1',
      })
    ).resolves.toBe('two-factor-1');

    expect(values).toHaveBeenCalledTimes(1);
    const payload = (values as jest.Mock).mock.calls[0]?.[0];
    expect(payload.two_factor_id).toBe('two-factor-1');
    expect(payload.user_id).toBe('user-1');
    expect(payload.code).toBe('123456');
    expect(payload.token).toBe('token-1');
    expect(payload.created_at).toEqual(expect.any(String));
  });

  it('stores nullable fields as null when they are missing', async () => {
    const values = jest.fn(async () => undefined);
    const insert = jest.fn(() => ({
      values,
    }));
    const repository = new TwoFactorCreatorRepository({
      insert,
    } as never);
    const uuidMock = randomUUID as unknown as jest.Mock;
    uuidMock.mockReturnValue('two-factor-2');

    await repository.createTwoFactor({
      code: '654321',
      token: 'token-2',
    });

    const payload = (values as jest.Mock).mock.calls[0]?.[0];
    expect(payload.user_id).toBeNull();
    expect(payload.phone_ddi).toBeNull();
    expect(payload.phone).toBeNull();
    expect(payload.phone_partial).toBeNull();
    expect(payload.phone_c).toBeNull();
    expect(payload.email).toBeNull();
    expect(payload.email_partial).toBeNull();
    expect(payload.email_c).toBeNull();
  });
});
