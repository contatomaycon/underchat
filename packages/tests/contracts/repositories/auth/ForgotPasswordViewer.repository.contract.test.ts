import 'reflect-metadata';
import { ForgotPasswordViewerRepository } from '@core/repositories/auth/ForgotPasswordViewer.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ForgotPasswordViewerRepository', () => {
  it('returns user payload when email exists', async () => {
    const { db } = createSelectDbMock([
      {
        user_id: 'user-1',
        account_id: 'acc-1',
        email: 'mail@test.com',
        phone: '11999999999',
        phone_ddi: '55',
        name: 'John',
      },
    ]);
    const repository = new ForgotPasswordViewerRepository(db as never);

    await expect(
      repository.findUserByEmailForForgotPassword('mailc')
    ).resolves.toEqual({
      user_id: 'user-1',
      account_id: 'acc-1',
      email: 'mail@test.com',
      phone: '11999999999',
      phone_ddi: '55',
      name: 'John',
    });
  });

  it('returns null when user is not found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ForgotPasswordViewerRepository(db as never);

    await expect(
      repository.findUserByEmailForForgotPassword('mailc')
    ).resolves.toBeNull();
  });
});
