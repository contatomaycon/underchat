import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/useCases/config/ChannelRecreator.useCase', () => ({
  ChannelRecreatorUseCase: class {},
}));

import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';

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
      useCase.execute(t as never, { server_id: 'srv-1' } as never)
    ).rejects.toThrow('no_channels_to_recreate');
    expect(channelRecreatorUseCase.execute).not.toHaveBeenCalled();
  });

  it('returns all success when all channel recreations succeed', async () => {
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
      useCase.execute(jest.fn() as never, { server_id: 'srv-1' } as never)
    ).resolves.toEqual({
      success: 2,
      errors: 0,
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
