import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/useCases/worker/WorkerUpdater.useCase', () => ({
  WorkerUpdaterUseCase: class {},
}));

import { ChannelUpdaterUseCase } from '@core/useCases/config/ChannelUpdater.useCase';

describe('ChannelUpdaterUseCase', () => {
  it('throws when channel is not found', async () => {
    const configService = {
      viewChannelBalancer: jest.fn(async () => null),
    };
    const workerUpdaterUseCase = {
      execute: jest.fn(),
    };
    const useCase = new ChannelUpdaterUseCase(
      configService as never,
      workerUpdaterUseCase as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          channel_id: 'worker-1',
          name: 'Channel 1',
        } as never
      )
    ).rejects.toThrow('channel_not_found');
    expect(workerUpdaterUseCase.execute).not.toHaveBeenCalled();
  });

  it('delegates update to WorkerUpdaterUseCase', async () => {
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({ account_id: 'acc-1' })),
    };
    const workerUpdaterUseCase = {
      execute: jest.fn(async () => true),
    };
    const useCase = new ChannelUpdaterUseCase(
      configService as never,
      workerUpdaterUseCase as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          channel_id: 'worker-1',
          name: 'Channel 1',
          worker_type: 'type-a',
          server_id: 'server-1',
        } as never
      )
    ).resolves.toBe(true);

    expect(workerUpdaterUseCase.execute).toHaveBeenCalledWith(t, 'acc-1', {
      worker_id: 'worker-1',
      name: 'Channel 1',
      worker_type: 'type-a',
      server_id: 'server-1',
    });
  });
});
