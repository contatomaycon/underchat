import 'reflect-metadata';
import { UpdateOperatorReplyPendingRedistributionUseCase } from '@core/useCases/worker/UpdateOperatorReplyPendingRedistribution.useCase';
import { ViewOperatorReplyPendingRedistributionUseCase } from '@core/useCases/worker/ViewOperatorReplyPendingRedistribution.useCase';

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/sector.service', () => ({
  SectorService: class SectorService {},
}));

const t = ((key: string) => key) as never;

const availableSectors = [
  { id: 'sector-1', name: 'Sales', color: '#111111' },
  { id: 'sector-2', name: 'Support', color: null },
];

function buildDependencies() {
  const workerConfigService = {
    viewOperatorReplyPendingRedistribution: jest.fn().mockResolvedValue({
      enabled: true,
      time_minutes: 15,
      sector_ids: ['sector-1'],
    }),
    updateOperatorReplyPendingRedistribution: jest.fn(
      async (
        _workerId: string,
        config: { enabled: boolean; time_minutes: number; sector_ids: string[] }
      ) => config
    ),
  };
  const workerService = {
    existsWorkerById: jest.fn().mockResolvedValue(true),
  };
  const sectorService = {
    listSectorsForTransfer: jest.fn().mockResolvedValue(availableSectors),
  };

  return {
    workerConfigService,
    workerService,
    sectorService,
    updateUseCase: new UpdateOperatorReplyPendingRedistributionUseCase(
      workerConfigService as never,
      workerService as never,
      sectorService as never
    ),
    viewUseCase: new ViewOperatorReplyPendingRedistributionUseCase(
      workerConfigService as never,
      workerService as never,
      sectorService as never
    ),
  };
}

describe('operator reply pending redistribution use cases', () => {
  it('deduplicates and validates every selected sector before updating', async () => {
    const dependencies = buildDependencies();

    await expect(
      dependencies.updateUseCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
        time_minutes: 10,
        sector_ids: ['sector-2', 'sector-1', 'sector-2'],
      })
    ).resolves.toEqual({
      enabled: true,
      time_minutes: 10,
      sector_ids: ['sector-2', 'sector-1'],
    });

    expect(
      dependencies.sectorService.listSectorsForTransfer
    ).toHaveBeenCalledWith('account-1');
    expect(
      dependencies.workerConfigService.updateOperatorReplyPendingRedistribution
    ).toHaveBeenCalledWith('worker-1', {
      enabled: true,
      time_minutes: 10,
      sector_ids: ['sector-2', 'sector-1'],
    });
  });

  it('preserves the current sector scope when the optional field is omitted', async () => {
    const dependencies = buildDependencies();

    await expect(
      dependencies.updateUseCase.execute(t, 'account-1', 'worker-1', {
        enabled: false,
        time_minutes: 20,
      })
    ).resolves.toEqual({
      enabled: false,
      time_minutes: 20,
      sector_ids: ['sector-1'],
    });

    expect(
      dependencies.workerConfigService.viewOperatorReplyPendingRedistribution
    ).toHaveBeenCalledWith('worker-1');
  });

  it('uses an explicit empty sector list as the global scope', async () => {
    const dependencies = buildDependencies();

    await expect(
      dependencies.updateUseCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
        time_minutes: 15,
        sector_ids: [],
      })
    ).resolves.toEqual({
      enabled: true,
      time_minutes: 15,
      sector_ids: [],
    });

    expect(
      dependencies.sectorService.listSectorsForTransfer
    ).not.toHaveBeenCalled();
  });

  it('rejects the whole update when any sector is unavailable to the account', async () => {
    const dependencies = buildDependencies();

    await expect(
      dependencies.updateUseCase.execute(t, 'account-1', 'worker-1', {
        enabled: true,
        time_minutes: 10,
        sector_ids: ['sector-1', 'sector-from-another-account'],
      })
    ).rejects.toThrow('sector_not_found');

    expect(
      dependencies.workerConfigService.updateOperatorReplyPendingRedistribution
    ).not.toHaveBeenCalled();
  });

  it('returns the configuration together with the available sectors', async () => {
    const dependencies = buildDependencies();

    await expect(
      dependencies.viewUseCase.execute(t, 'account-1', 'worker-1')
    ).resolves.toEqual({
      enabled: true,
      time_minutes: 15,
      sector_ids: ['sector-1'],
      available_sectors: availableSectors,
    });
  });
});
