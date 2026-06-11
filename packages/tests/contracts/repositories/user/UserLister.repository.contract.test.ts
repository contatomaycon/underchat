import 'reflect-metadata';
import { UserListerRepository } from '@core/repositories/user/UserLister.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

function createSubquerySelectMock() {
  return jest.fn(() => ({
    from: jest.fn(() => ({
      where: jest.fn(() => ({ subquery: true })),
    })),
  }));
}

function createListUsersTotalSelectMock(result: unknown[]) {
  const chain: {
    leftJoin: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  } = {
    leftJoin: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => result),
  };
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return jest.fn(() => ({
    from: jest.fn(() => chain),
  }));
}

function createListUsersSectorsSelectMock(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    execute: jest.fn(async () => result),
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return jest.fn(() => ({
    from: jest.fn(() => chain),
  }));
}

describe('UserListerRepository', () => {
  it('setFiltersUser returns empty array when search is not provided', () => {
    const repository = new UserListerRepository(
      { select: jest.fn() } as never,
      { getStatus: jest.fn() } as never
    );

    const filters = (repository as any).setFiltersUser({} as never, null);
    expect(filters).toEqual([]);
  });

  it('setFiltersUser and setFilters build conditions from query fields', () => {
    const repository = new UserListerRepository(
      { select: createSubquerySelectMock() } as never,
      { getStatus: jest.fn() } as never
    );

    const filtersUser = (repository as any).setFiltersUser(
      { search: 'john' } as never,
      'hash-1'
    );
    const filters = (repository as any).setFilters({
      user_status: 'status-1',
      permission_role_id: 'role-1',
    } as never);

    expect(filtersUser).toHaveLength(1);
    expect(filters).toHaveLength(2);
  });

  it('listUsers returns empty array when findMany returns null', async () => {
    const repository = new UserListerRepository(
      {
        select: createListUsersSectorsSelectMock([]),
        query: {
          user: {
            findMany: jest.fn(async () => null),
          },
        },
      } as never,
      { getStatus: jest.fn() } as never
    );

    await expect(
      repository.listUsers(10, 1, {} as never, null, null)
    ).resolves.toEqual([]);
  });

  it('listUsers maps payload and falls back to offline status', async () => {
    const repository = new UserListerRepository(
      {
        select: createListUsersSectorsSelectMock([]),
        query: {
          user: {
            findMany: jest.fn(async () => [
              {
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
                uua: {
                  user_address_id: 'addr-1',
                  zip_code: '01001-000',
                  address1_partial: 'Av X',
                  address2_partial: null,
                  city_fiscal_code: null,
                  state_fiscal_code: null,
                  district: 'Centro',
                  deleted_at: null,
                  uzc: { city: 'Sao Paulo' },
                  uzs: { state: 'Sao Paulo', abbreviation: 'SP' },
                  uuc: { country_id: 55, iso_code: 'BR', name: 'Brazil' },
                },
                ucu: { chat_user_id: 'chat-1' },
                upa: {
                  permission_assignment_id: 'pa-1',
                  permission_role_id: 'role-1',
                  ppr: { permission_role_id: 'role-1', name: 'Admin' },
                },
              },
            ]),
          },
        },
      } as never,
      { getStatus: jest.fn(async () => null) } as never
    );

    const result = await repository.listUsers(10, 1, {} as never, null, null);
    expect(result[0].chat_user?.status).toBe(EChatUserStatus.offline);
    expect(result[0].user_address?.state).toBe('Sao Paulo (SP)');
  });

  it('listUsersTotal returns query count and defaults to zero', async () => {
    const repository = new UserListerRepository(
      {
        select: createListUsersTotalSelectMock([{ count: 3 }]),
      } as never,
      { getStatus: jest.fn() } as never
    );
    const repositoryZero = new UserListerRepository(
      {
        select: createListUsersTotalSelectMock([]),
      } as never,
      { getStatus: jest.fn() } as never
    );

    await expect(
      repository.listUsersTotal({} as never, null, null)
    ).resolves.toBe(3);
    await expect(
      repositoryZero.listUsersTotal({} as never, null, null)
    ).resolves.toBe(0);
  });
});
