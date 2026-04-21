import 'reflect-metadata';
import { UserInfoViewerRepository } from '@core/repositories/plan/UserInfoViewer.repository';

function createAddressSelect(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const chain: {
    leftJoin: jest.Mock;
    where: jest.Mock;
  } = {
    leftJoin: jest.fn(),
    where: jest.fn(),
  };
  const limit = jest.fn(() => ({ execute }));

  chain.where.mockReturnValue({ limit });
  chain.leftJoin.mockReturnValue(chain);
  const from = jest.fn(() => chain);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('UserInfoViewerRepository', () => {
  it('returns null when user is not found', async () => {
    const addressStep = createAddressSelect([]);

    const repository = new UserInfoViewerRepository({
      query: {
        user: {
          findFirst: jest.fn(async () => null),
        },
      },
      select: addressStep.select,
    } as never);

    await expect(repository.viewUserInfo('user-1')).resolves.toBeNull();
  });

  it('returns user payload with null nested data when optional relations are missing', async () => {
    const addressStep = createAddressSelect([]);

    const repository = new UserInfoViewerRepository({
      query: {
        user: {
          findFirst: jest.fn(async () => ({
            user_id: 'user-1',
            email_partial: 'u***@mail.com',
            uui: null,
            uud: null,
          })),
        },
      },
      select: addressStep.select,
    } as never);

    await expect(repository.viewUserInfo('user-1')).resolves.toEqual({
      user_id: 'user-1',
      email_partial: 'u***@mail.com',
      user_info: null,
      user_document: null,
      user_address: null,
    });
  });

  it('builds full response including formatted state abbreviation', async () => {
    const addressStep = createAddressSelect([
      {
        user_address_id: 'addr-1',
        zip_code: '01001000',
        address1_partial: 'Praça da Sé',
        address2_partial: null,
        district: 'Sé',
        uuc: {
          country_id: 1,
          iso_code: 'BR',
          name: 'Brazil',
        },
        uzc: {
          city: 'São Paulo',
        },
        uzs: {
          state: 'São Paulo',
          abbreviation: 'SP',
        },
      },
    ]);

    const repository = new UserInfoViewerRepository({
      query: {
        user: {
          findFirst: jest.fn(async () => ({
            user_id: 'user-1',
            email_partial: 'u***@mail.com',
            uui: {
              user_info_id: 'info-1',
              phone_ddi: '55',
              phone_partial: '***9999',
              name: 'John',
              last_name: 'Doe',
              birth_date: '1990-01-01',
              photo: null,
            },
            uud: {
              user_document_id: 'doc-1',
              document_partial: '***123',
              udt: {
                user_document_type_id: 'cpf',
                name: 'CPF',
              },
            },
          })),
        },
      },
      select: addressStep.select,
    } as never);

    await expect(repository.viewUserInfo('user-1')).resolves.toEqual({
      user_id: 'user-1',
      email_partial: 'u***@mail.com',
      user_info: {
        user_info_id: 'info-1',
        phone_ddi: '55',
        phone_partial: '***9999',
        name: 'John',
        last_name: 'Doe',
        birth_date: '1990-01-01',
        photo: null,
      },
      user_document: {
        user_document_id: 'doc-1',
        document_partial: '***123',
        user_document_type: {
          user_document_type_id: 'cpf',
          name: 'CPF',
        },
      },
      user_address: {
        user_address_id: 'addr-1',
        zip_code: '01001000',
        address1_partial: 'Praça da Sé',
        address2_partial: null,
        city: 'São Paulo',
        state: 'São Paulo (SP)',
        district: 'Sé',
        country: {
          country_id: 1,
          iso_code: 'BR',
          name: 'Brazil',
        },
      },
    });
  });
});
