import 'reflect-metadata';

jest.mock('@core/services/role.service', () => ({
  RoleService: class {},
}));

import { RoleListerUseCase } from '@core/useCases/role/RoleLister.useCase';

describe('RoleListerUseCase', () => {
  it('uses query pagination and returns pagings with results', async () => {
    const query = { per_page: 5, current_page: 3 } as never;
    const results = [{ role_id: 'role-1' }];
    const service = {
      listRoles: jest.fn(async () => [results, 11]),
    };
    const useCase = new RoleListerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, query, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 3,
        total_pages: 3,
        per_page: 5,
        count: 1,
        total: 11,
      },
      results,
    });

    expect(service.listRoles).toHaveBeenCalledWith(5, 3, query, 'acc-1');
  });

  it('uses default pagination when values are not provided', async () => {
    const service = {
      listRoles: jest.fn(async () => [[], 0]),
    };
    const useCase = new RoleListerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, {} as never, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });

    expect(service.listRoles).toHaveBeenCalledWith(10, 1, {}, 'acc-1');
  });
});
