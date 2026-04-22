import 'reflect-metadata';

jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));

import { SectorUpdaterUseCase } from '@core/useCases/sector/SectorUpdater.useCase';

describe('SectorUpdaterUseCase', () => {
  it('throws when sector does not exist', async () => {
    const service = {
      existsSectorById: jest.fn(async () => false),
      existsSectorStatusById: jest.fn(),
      updateSectorById: jest.fn(),
    };
    const useCase = new SectorUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'sec-1', {} as never, 'acc-1')
    ).rejects.toThrow('sector_not_found');
    expect(service.existsSectorStatusById).not.toHaveBeenCalled();
    expect(service.updateSectorById).not.toHaveBeenCalled();
  });

  it('throws when provided sector status does not exist', async () => {
    const service = {
      existsSectorById: jest.fn(async () => true),
      existsSectorStatusById: jest.fn(async () => false),
      updateSectorById: jest.fn(),
    };
    const useCase = new SectorUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        'sec-1',
        { sector_status_id: 'status-1' } as never,
        'acc-1'
      )
    ).rejects.toThrow('sector_status_not_found');
    expect(service.updateSectorById).not.toHaveBeenCalled();
  });

  it('throws when update operation fails', async () => {
    const service = {
      existsSectorById: jest.fn(async () => true),
      existsSectorStatusById: jest.fn(async () => true),
      updateSectorById: jest.fn(async () => false),
    };
    const useCase = new SectorUpdaterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        'sec-1',
        { sector_status_id: 'status-1' } as never,
        'acc-1'
      )
    ).rejects.toThrow('sector_update_error');
  });

  it('skips status validation when sector_status_id is not provided', async () => {
    const input = { name: 'New Sector' } as never;
    const service = {
      existsSectorById: jest.fn(async () => true),
      existsSectorStatusById: jest.fn(),
      updateSectorById: jest.fn(async () => true),
    };
    const useCase = new SectorUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'sec-1', input, 'acc-1')
    ).resolves.toBe(true);

    expect(service.existsSectorStatusById).not.toHaveBeenCalled();
    expect(service.updateSectorById).toHaveBeenCalledWith(
      expect.any(Function),
      'sec-1',
      input,
      'acc-1'
    );
  });
});
