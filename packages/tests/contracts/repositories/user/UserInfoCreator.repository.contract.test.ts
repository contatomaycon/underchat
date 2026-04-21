import 'reflect-metadata';
import { UserInfoCreatorRepository } from '@core/repositories/user/UserInfoCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('UserInfoCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('info-id-1');
  });

  it('returns true when createUserInfo inserts one row', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    } as never;

    const repository = new UserInfoCreatorRepository({} as never);

    await expect(
      repository.createUserInfo(
        tx,
        {
          phone_ddi: null,
          phone: null,
          phone_partial: null,
          phone_c: null,
          photo: null,
          name: 'John',
          last_name: 'Doe',
          birth_date: null,
        },
        'user-1'
      )
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_info_id: 'info-id-1',
        user_id: 'user-1',
        phone_ddi: null,
        phone: null,
        phone_partial: null,
        phone_c: null,
        photo: null,
        birth_date: null,
      })
    );
  });

  it('returns false when createUserInfo inserts zero rows', async () => {
    const repository = new UserInfoCreatorRepository({} as never);
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never;

    await expect(
      repository.createUserInfo(
        tx,
        { name: 'John', last_name: 'Doe' } as never,
        'user-1'
      )
    ).resolves.toBe(false);
  });
});
