import 'reflect-metadata';
jest.mock('@core/services/dashboard.service', () => ({
  DashboardService: class {},
}));
import { DashboardStatsViewerUseCase } from '@core/useCases/dashboard/DashboardStatsViewer.useCase';

describe('DashboardStatsViewerUseCase', () => {
  it('delegates to dashboard service', async () => {
    const result = { conversations: 10 };
    const service = {
      getDashboardStats: jest.fn(async () => result),
    };
    const useCase = new DashboardStatsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.getDashboardStats).toHaveBeenCalledWith('acc-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      getDashboardStats: jest.fn(async () => null),
    };
    const useCase = new DashboardStatsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toBeNull();
  });

  it('propagates service errors', async () => {
    const serviceError = new Error('dashboard failed');
    const service = {
      getDashboardStats: jest.fn(async () => {
        throw serviceError;
      }),
    };
    const useCase = new DashboardStatsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).rejects.toBe(serviceError);
  });
});
