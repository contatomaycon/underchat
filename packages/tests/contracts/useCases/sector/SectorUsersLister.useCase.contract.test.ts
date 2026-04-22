import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));

import { SectorUsersListerUseCase } from '@core/useCases/sector/SectorUsersLister.useCase';

describe('SectorUsersListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const sectorService = {
      sectorByIdExists: jest.fn(),
      listSectorUsers: jest.fn(),
    };

    const useCase = new SectorUsersListerUseCase(
      accountService as never,
      sectorService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'sec-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(sectorService.sectorByIdExists).not.toHaveBeenCalled();
  });

  it('throws when sector does not exist', async () => {
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const sectorService = {
      sectorByIdExists: jest.fn(async () => false),
      listSectorUsers: jest.fn(),
    };

    const useCase = new SectorUsersListerUseCase(
      accountService as never,
      sectorService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1', 'sec-1')).rejects.toThrow(
      'sector_not_found'
    );
    expect(sectorService.listSectorUsers).not.toHaveBeenCalled();
  });

  it('returns sector users when account and sector exist', async () => {
    const users = [{ user_id: 'u-1' }];
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const sectorService = {
      sectorByIdExists: jest.fn(async () => true),
      listSectorUsers: jest.fn(async () => users),
    };

    const useCase = new SectorUsersListerUseCase(
      accountService as never,
      sectorService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'sec-1')
    ).resolves.toEqual(users);
    expect(sectorService.listSectorUsers).toHaveBeenCalledWith(
      'acc-1',
      'sec-1'
    );
  });
});
