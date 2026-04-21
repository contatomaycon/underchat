import 'reflect-metadata';

jest.mock('@core/services/dashboard.service', () => ({
  DashboardService: class {},
}));

import { DashboardAdditionalViewerUseCase } from '@core/useCases/dashboard/DashboardAdditionalViewer.useCase';

describe('DashboardAdditionalViewerUseCase', () => {
  it('throws not authorized when accountId is invalid', async () => {
    const service = { getDashboardAdditional: jest.fn() };
    const useCase = new DashboardAdditionalViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute('', t as never)).rejects.toThrow(
      'not_authorized'
    );
    await expect(useCase.execute(123 as never, t as never)).rejects.toThrow(
      'not_authorized'
    );
    expect(service.getDashboardAdditional).not.toHaveBeenCalled();
  });

  it('delegates call to dashboard service', async () => {
    const result = { channels: [] };
    const service = {
      getDashboardAdditional: jest.fn(async () => result),
    };
    const useCase = new DashboardAdditionalViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute('acc-1', t as never)).resolves.toEqual(result);
    expect(service.getDashboardAdditional).toHaveBeenCalledWith('acc-1', t);
  });
});
