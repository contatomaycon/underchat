import 'reflect-metadata';
import { UserCreatorRepository } from '@core/repositories/user/UserCreator.repository';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('UserCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('user-id-1');
  });

  it('returns created user id when returning has rows', async () => {
    const returning = jest.fn(async () => [{ user_id: 'user-id-1' }]);
    const values = jest.fn(() => ({ returning }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    } as never;
    const repository = new UserCreatorRepository({} as never);

    await expect(
      repository.createUser(tx, {
        account_id: 'account-1',
        email: 'enc-email',
        email_partial: 'partial',
        email_c: 'email-c',
        password: 'pass',
      } as never)
    ).resolves.toBe('user-id-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-id-1',
        user_status_id: EUserStatus.active,
      })
    );
  });

  it('returns null when returning is empty', async () => {
    const repository = new UserCreatorRepository({} as never);
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(async () => []),
        })),
      })),
    } as never;

    await expect(
      repository.createUser(tx, {
        account_id: 'account-1',
        user_status_id: EUserStatus.inactive,
        email: 'enc-email',
        email_partial: 'partial',
        email_c: 'email-c',
        password: 'pass',
      } as never)
    ).resolves.toBeNull();
  });
});
