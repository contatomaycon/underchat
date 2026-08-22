import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/useCases/worker/WorkerConnectionLogs.useCase', () => ({
  WorkerConnectionLogsUseCase: class {},
}));

import { ConfigChannelConnectionHealthUseCase } from '@core/useCases/config/ConfigChannelConnectionHealth.useCase';

const t = ((key: string) => key) as never;

describe('ConfigChannelConnectionHealthUseCase', () => {
  it('uses the account that owns the selected administrative channel', async () => {
    const health = { generated_at: '2026-08-17T12:00:00.000Z' };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'other-account',
      })),
    };
    const workerConnectionLogsUseCase = {
      execute: jest.fn(async () => health),
    };
    const useCase = new ConfigChannelConnectionHealthUseCase(
      configService as never,
      workerConnectionLogsUseCase as never
    );
    const query = { from: 10, size: 20, period_hours: 72 as const };

    await expect(useCase.execute(t, 'worker-1', query)).resolves.toBe(health);
    expect(configService.viewChannelContext).toHaveBeenCalledWith('worker-1');
    expect(workerConnectionLogsUseCase.execute).toHaveBeenCalledWith(
      t,
      'other-account',
      'worker-1',
      query
    );
  });

  it('does not request health when the administrative channel is missing', async () => {
    const configService = {
      viewChannelContext: jest.fn(async () => null),
    };
    const workerConnectionLogsUseCase = {
      execute: jest.fn(),
    };
    const useCase = new ConfigChannelConnectionHealthUseCase(
      configService as never,
      workerConnectionLogsUseCase as never
    );

    await expect(useCase.execute(t, 'missing-worker', {})).rejects.toThrow(
      'worker_not_found'
    );
    expect(workerConnectionLogsUseCase.execute).not.toHaveBeenCalled();
  });
});
