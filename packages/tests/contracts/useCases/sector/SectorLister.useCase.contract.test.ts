import 'reflect-metadata';

jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { SectorListerUseCase } from '@core/useCases/sector/SectorLister.useCase';

describe('SectorListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const sectorService = { listSector: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const useCase = new SectorListerUseCase(
      sectorService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, {} as never, 'acc-1')
    ).rejects.toThrow('account_not_found');
    expect(sectorService.listSector).not.toHaveBeenCalled();
  });

  it('uses default pagination when values are missing', async () => {
    const sectorService = { listSector: jest.fn(async () => [[], 0]) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new SectorListerUseCase(
      sectorService as never,
      accountService as never
    );

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

    expect(sectorService.listSector).toHaveBeenCalledWith(10, 1, {}, 'acc-1');
  });

  it('uses query pagination and returns mapped response', async () => {
    const query = { per_page: 2, current_page: 3 } as never;
    const results = [{ sector_id: 'sec-1' }];
    const sectorService = { listSector: jest.fn(async () => [results, 7]) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new SectorListerUseCase(
      sectorService as never,
      accountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, query, 'acc-1')
    ).resolves.toEqual({
      pagings: {
        current_page: 3,
        total_pages: 4,
        per_page: 2,
        count: 1,
        total: 7,
      },
      results,
    });
  });
});
