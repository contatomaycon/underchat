import 'reflect-metadata';
jest.mock('@core/services/dashboard.service', () => ({
  DashboardService: class {},
}));
import { DashboardConversationsViewerUseCase } from '@core/useCases/dashboard/DashboardConversationsViewer.useCase';

describe('DashboardConversationsViewerUseCase', () => {
  it('delegates to dashboard service', async () => {
    const result = { total: 5 };
    const service = {
      getDashboardConversations: jest.fn(async () => result),
    };
    const useCase = new DashboardConversationsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.getDashboardConversations).toHaveBeenCalledWith('acc-1');
  });

  it('returns null when service returns null', async () => {
    const service = {
      getDashboardConversations: jest.fn(async () => null),
    };
    const useCase = new DashboardConversationsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toBeNull();
  });

  it('propagates service errors', async () => {
    const serviceError = new Error('dashboard failed');
    const service = {
      getDashboardConversations: jest.fn(async () => {
        throw serviceError;
      }),
    };
    const useCase = new DashboardConversationsViewerUseCase(service as never);

    await expect(useCase.execute('acc-1')).rejects.toBe(serviceError);
  });
});
