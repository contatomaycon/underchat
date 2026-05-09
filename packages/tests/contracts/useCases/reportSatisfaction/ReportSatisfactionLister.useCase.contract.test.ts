import 'reflect-metadata';
jest.mock('@core/services/sector.service', () => ({
  SectorService: class {},
}));
jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
import { ReportSatisfactionListerUseCase } from '@core/useCases/reportSatisfaction/ReportSatisfactionLister.useCase';

describe('ReportSatisfactionListerUseCase', () => {
  const sectorService = {
    listAllSectorsForReport: jest.fn(async () => []),
  };
  const userService = {
    listAllUsers: jest.fn(async () => []),
  };

  it('includes channel filter when channel_id is provided', async () => {
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
      })),
    };

    const useCase = new ReportSatisfactionListerUseCase(
      elasticDatabaseService as never,
      sectorService as never,
      userService as never
    );

    await useCase.execute('acc-1', {
      report_type: 'general',
      period: 'day',
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: '2026-01-31T23:59:59.999Z',
      channel_id: 'worker-1',
    });

    const selectMock = elasticDatabaseService.select as jest.Mock;
    expect(selectMock).toHaveBeenCalledTimes(1);
    const elasticQuery = selectMock.mock.calls[0][1] as any;
    const serializedFilter = JSON.stringify(elasticQuery.query.bool.filter);

    expect(serializedFilter).toContain('"path":"worker"');
    expect(serializedFilter).toContain('"worker.id":"worker-1"');
  });

  it('does not include channel filter when channel_id is not provided', async () => {
    const elasticDatabaseService = {
      select: jest.fn(async () => ({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
      })),
    };

    const useCase = new ReportSatisfactionListerUseCase(
      elasticDatabaseService as never,
      sectorService as never,
      userService as never
    );

    await useCase.execute('acc-1', {
      report_type: 'general',
      period: 'day',
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: '2026-01-31T23:59:59.999Z',
    });

    const selectMock = elasticDatabaseService.select as jest.Mock;
    expect(selectMock).toHaveBeenCalledTimes(1);
    const elasticQuery = selectMock.mock.calls[0][1] as any;
    const serializedFilter = JSON.stringify(elasticQuery.query.bool.filter);

    expect(serializedFilter).not.toContain('"worker.id"');
  });
});
