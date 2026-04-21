import 'reflect-metadata';
import { AuthService } from '@core/services/auth.service';

describe('AuthService', () => {
  it('encrypts login/password and delegates authenticate and hasValidCredentials', async () => {
    const authenticate = jest.fn(async () => ({ token: 't' }));
    const hasValidCredentials = jest.fn(async () => true);
    const encrypt = jest.fn((value: string) => `enc:${value}`);

    const service = new AuthService(
      {
        authenticate,
        hasValidCredentials,
        authenticateByUserId: jest.fn(),
      } as never,
      { encrypt } as never
    );

    await expect(service.authenticate('user@mail.com', '123')).resolves.toEqual(
      {
        token: 't',
      }
    );
    await expect(
      service.hasValidCredentials('user@mail.com', '123')
    ).resolves.toBe(true);

    expect(encrypt).toHaveBeenNthCalledWith(1, '123');
    expect(encrypt).toHaveBeenNthCalledWith(2, 'user@mail.com');
    expect(encrypt).toHaveBeenNthCalledWith(3, '123');
    expect(encrypt).toHaveBeenNthCalledWith(4, 'user@mail.com');
    expect(authenticate).toHaveBeenCalledWith({
      email: 'enc:user@mail.com',
      password: 'enc:123',
    });
    expect(hasValidCredentials).toHaveBeenCalledWith({
      email: 'enc:user@mail.com',
      password: 'enc:123',
    });
  });

  it('delegates authenticateByUserId', async () => {
    const authenticateByUserId = jest.fn(async () => ({ user_id: 'u1' }));
    const service = new AuthService(
      {
        authenticate: jest.fn(),
        hasValidCredentials: jest.fn(),
        authenticateByUserId,
      } as never,
      { encrypt: jest.fn() } as never
    );

    await expect(service.authenticateByUserId('u1', 'a1')).resolves.toEqual({
      user_id: 'u1',
    });
    expect(authenticateByUserId).toHaveBeenCalledWith('u1', 'a1');
  });
});
