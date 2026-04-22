import 'reflect-metadata';

jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { SectorCreatorUseCase } from '@core/useCases/sector/SectorCreator.useCase';

describe('SectorCreatorUseCase', () => {
  it('throws when account does not exist', async () => {
    const sectorService = { createSector: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const useCase = new SectorCreatorUseCase(
      sectorService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: 'Sales' } as never, 'acc-1')
    ).rejects.toThrow('account_not_found');
    expect(sectorService.createSector).not.toHaveBeenCalled();
  });

  it('throws when sector creation fails', async () => {
    const sectorService = { createSector: jest.fn(async () => null) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new SectorCreatorUseCase(
      sectorService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: 'Sales' } as never, 'acc-1')
    ).rejects.toThrow('sector_creator_error');
  });

  it('returns created sector when creation succeeds', async () => {
    const created = { sector_id: 'sec-1' };
    const input = { name: 'Sales' } as never;
    const sectorService = { createSector: jest.fn(async () => created) };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new SectorCreatorUseCase(
      sectorService as never,
      accountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1')
    ).resolves.toEqual(created);

    expect(sectorService.createSector).toHaveBeenCalledWith(
      expect.any(Function),
      input,
      'acc-1'
    );
  });
});
