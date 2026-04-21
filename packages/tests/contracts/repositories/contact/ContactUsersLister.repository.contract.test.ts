import 'reflect-metadata';
import { ContactUsersListerRepository } from '@core/repositories/contact/ContactUsersLister.repository';

describe('ContactUsersListerRepository', () => {
  it('returns empty list when query result is null', async () => {
    const dbRo = {
      query: {
        user: {
          findMany: jest.fn(async () => null),
        },
      },
    };
    const repository = new ContactUsersListerRepository(dbRo as never);

    await expect(repository.listContactUsers('acc-1')).resolves.toEqual([]);
  });

  it('maps users combining name and last name', async () => {
    const dbRo = {
      query: {
        user: {
          findMany: jest.fn(async () => [
            {
              user_id: 'u-1',
              uui: {
                name: 'Maycon',
                last_name: 'Silva',
                photo: 'photo-1',
              },
            },
            {
              user_id: 'u-2',
              uui: null,
            },
          ]),
        },
      },
    };
    const repository = new ContactUsersListerRepository(dbRo as never);

    await expect(repository.listContactUsers('acc-1')).resolves.toEqual([
      {
        user_id: 'u-1',
        name: 'Maycon Silva',
        photo: 'photo-1',
      },
      {
        user_id: 'u-2',
        name: null,
        photo: null,
      },
    ]);
  });
});
