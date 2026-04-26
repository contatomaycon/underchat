import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/useCases/config/ChannelRecreator.useCase', () => ({
  ChannelRecreatorUseCase: class {},
}));

import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

describe('ChannelsRecreatorAllUseCase', () => {
  it('throws when there are no channels to recreate', async () => {
    const configService = {
      listAllNonDeletedChannelIds: jest.fn(async () => []),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(),
    };
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { account: 'acc-filter' })
    ).rejects.toThrow('no_channels_to_recreate');
    expect(configService.listAllNonDeletedChannelIds).toHaveBeenCalledWith({
      status: EWorkerStatus.online,
      type: undefined,
      account: 'acc-filter',
      name: undefined,
      number: undefined,
    });
    expect(channelRecreatorUseCase.execute).not.toHaveBeenCalled();
  });

  it('preserves explicit status when listing channels to recreate', async () => {
    const configService = {
      listAllNonDeletedChannelIds: jest.fn(async () => ['w1', 'w2']),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never
    );

    await expect(
      useCase.execute(jest.fn() as never, {
        status: EWorkerStatus.error,
        name: 'Channel',
        number: '5511999999999',
      })
    ).resolves.toEqual({
      success: 2,
      errors: 0,
    });
    expect(configService.listAllNonDeletedChannelIds).toHaveBeenCalledWith({
      status: EWorkerStatus.error,
      type: undefined,
      account: undefined,
      name: 'Channel',
      number: '5511999999999',
    });
  });

  it('counts fulfilled and rejected recreations', async () => {
    const configService = {
      listAllNonDeletedChannelIds: jest.fn(async () => ['w1', 'w2', 'w3']),
    };
    const channelRecreatorUseCase = {
      execute: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(true),
    };
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never
    );

    await expect(
      useCase.execute(jest.fn() as never, { server_id: 'srv-1' } as never)
    ).resolves.toEqual({
      success: 2,
      errors: 1,
    });
  });
});
