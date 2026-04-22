import 'reflect-metadata';

jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));

import { SectorDeleterUseCase } from '@core/useCases/sector/SectorDeleter.useCase';

describe('SectorDeleterUseCase', () => {
  it('throws when sector does not exist', async () => {
    const service = {
      existsSectorById: jest.fn(async () => false),
      deleteSectorById: jest.fn(),
    };
    const useCase = new SectorDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'sec-1', 'acc-1')).rejects.toThrow(
      'sector_not_found'
    );
    expect(service.deleteSectorById).not.toHaveBeenCalled();
  });

  it('throws when deletion fails', async () => {
    const service = {
      existsSectorById: jest.fn(async () => true),
      deleteSectorById: jest.fn(async () => false),
    };
    const useCase = new SectorDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'sec-1', 'acc-1')).rejects.toThrow(
      'sector_deleter_error'
    );
  });

  it('returns true when deletion succeeds', async () => {
    const service = {
      existsSectorById: jest.fn(async () => true),
      deleteSectorById: jest.fn(async () => true),
    };
    const useCase = new SectorDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'sec-1', 'acc-1')
    ).resolves.toBe(true);
  });
});
