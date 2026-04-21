import 'reflect-metadata';
import { UserInfoViewerRepository } from '@core/repositories/user/UserInfoViewer.repository';

describe('UserInfoViewerRepository', () => {
  it('returns user info payload from query.findFirst', async () => {
    const result = {
      phone: '11999999999',
      phone_ddi: '55',
      phone_jid: '5511999999999@s.whatsapp.net',
      name: 'John',
      last_name: 'Doe',
    };

    const repository = new UserInfoViewerRepository({
      query: {
        userInfo: {
          findFirst: jest.fn(async () => result),
        },
      },
    } as never);

    await expect(repository.findUserInfoByUserId('user-1')).resolves.toEqual(
      result
    );
  });

  it('returns null when findFirst has no row', async () => {
    const repository = new UserInfoViewerRepository({
      query: {
        userInfo: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(repository.findUserInfoByUserId('user-1')).resolves.toBeNull();
  });
});
