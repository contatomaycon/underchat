import 'reflect-metadata';

jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));

import { SectorViewerUseCase } from '@core/useCases/sector/SectorViewer.useCase';

describe('SectorViewerUseCase', () => {
  it('throws when sector does not exist', async () => {
    const service = {
      existsSectorById: jest.fn(async () => false),
      viewSectorById: jest.fn(),
    };
    const useCase = new SectorViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'sec-1', 'acc-1')).rejects.toThrow(
      'sector_not_found'
    );
    expect(service.viewSectorById).not.toHaveBeenCalled();
  });

  it('returns sector when sector exists', async () => {
    const sector = { sector_id: 'sec-1' };
    const service = {
      existsSectorById: jest.fn(async () => true),
      viewSectorById: jest.fn(async () => sector),
    };
    const useCase = new SectorViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'sec-1', 'acc-1')
    ).resolves.toEqual(sector);
    expect(service.viewSectorById).toHaveBeenCalledWith('sec-1', 'acc-1');
  });
});
