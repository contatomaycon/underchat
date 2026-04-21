import 'reflect-metadata';
import { UserViewerRepository } from '@core/repositories/user/UserViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserViewerRepository', () => {
  it('getCreatedAtByUserId returns null when no rows are found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserViewerRepository({
      ...dbMock.db,
      query: {
        user: { findFirst: jest.fn() },
        userAddress: { findFirst: jest.fn() },
      },
    } as never);

    await expect(repository.getCreatedAtByUserId('user-1')).resolves.toBeNull();
  });

  it('getCreatedAtByUserId returns created_at when row exists', async () => {
    const dbMock = createSelectDbMock([
      { created_at: '2026-04-21T10:00:00.000Z' },
    ]);
    const repository = new UserViewerRepository({
      ...dbMock.db,
      query: {
        user: { findFirst: jest.fn() },
        userAddress: { findFirst: jest.fn() },
      },
    } as never);

    await expect(repository.getCreatedAtByUserId('user-1')).resolves.toBe(
      '2026-04-21T10:00:00.000Z'
    );
  });

  it('viewUserById returns null when user is not found', async () => {
    const repository = new UserViewerRepository({
      select: jest.fn(),
      query: {
        user: { findFirst: jest.fn(async () => null) },
        userAddress: { findFirst: jest.fn() },
      },
    } as never);

    await expect(
      repository.viewUserById('user-1', 'account-1')
    ).resolves.toBeNull();
  });

  it('viewUserById maps full payload with abbreviated state', async () => {
    const repository = new UserViewerRepository({
      select: jest.fn(),
      query: {
        user: {
          findFirst: jest.fn(async () => ({
            user_id: 'user-1',
            email_partial: 'john',
            created_at: '2026-04-21T10:00:00.000Z',
            uac: { account_id: 'account-1', name: 'Acme' },
            uus: { user_status_id: 'active', name: 'Active' },
            uui: {
              user_info_id: 'info-1',
              phone_ddi: '55',
              phone_partial: '1199',
              name: 'John',
              last_name: 'Doe',
              birth_date: '1990-01-01',
              photo: 'photo',
            },
            uud: {
              user_document_id: 'doc-1',
              document_partial: '***123',
              udt: { user_document_type_id: 'cpf', name: 'CPF' },
            },
          })),
        },
        userAddress: {
          findFirst: jest.fn(async () => ({
            user_address_id: 'addr-1',
            zip_code: '01001-000',
            address1_partial: 'Av X',
            address2_partial: 'Apt 1',
            city_fiscal_code: '3550308',
            state_fiscal_code: '35',
            district: 'Centro',
            uzc: { city: 'Sao Paulo' },
            uzs: { state: 'Sao Paulo', abbreviation: 'SP' },
            uuc: { country_id: 55, iso_code: 'BR', name: 'Brazil' },
          })),
        },
      },
    } as never);

    await expect(
      repository.viewUserById('user-1', 'account-1')
    ).resolves.toEqual(
      expect.objectContaining({
        user_id: 'user-1',
        account: { account_id: 'account-1', name: 'Acme' },
        user_address: expect.objectContaining({
          state: 'Sao Paulo (SP)',
          city: 'Sao Paulo',
        }),
      })
    );
  });

  it('viewUserById maps state without abbreviation and null address', async () => {
    const repository = new UserViewerRepository({
      select: jest.fn(),
      query: {
        user: {
          findFirst: jest.fn(async () => ({
            user_id: 'user-1',
            email_partial: 'john',
            created_at: '2026-04-21T10:00:00.000Z',
            uac: { account_id: 'account-1', name: 'Acme' },
            uus: null,
            uui: null,
            uud: null,
          })),
        },
        userAddress: {
          findFirst: jest.fn(async () => ({
            user_address_id: 'addr-1',
            zip_code: null,
            address1_partial: null,
            address2_partial: null,
            city_fiscal_code: null,
            state_fiscal_code: null,
            district: null,
            uzc: null,
            uzs: { state: 'Sao Paulo', abbreviation: null },
            uuc: null,
          })),
        },
      },
    } as never);

    const result = await repository.viewUserById('user-1', 'account-1');
    expect(result?.user_address?.state).toBe('Sao Paulo');
    expect(result?.user_info).toBeNull();
    expect(result?.user_document).toBeNull();
  });
});
