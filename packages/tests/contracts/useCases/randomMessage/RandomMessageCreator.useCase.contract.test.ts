import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import { RandomMessageCreatorUseCase } from '@core/useCases/randomMessage/RandomMessageCreator.useCase';

describe('RandomMessageCreatorUseCase', () => {
  it('throws when name is empty after trim', async () => {
    const randomMessageService = {
      createRandomMessage: jest.fn(),
    };
    const useCase = new RandomMessageCreatorUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: '   ' } as never, 'acc-1')
    ).rejects.toThrow('random_message_name_required');
    expect(randomMessageService.createRandomMessage).not.toHaveBeenCalled();
  });

  it('throws when service does not return random message id', async () => {
    const randomMessageService = {
      createRandomMessage: jest.fn(async () => ''),
    };
    const useCase = new RandomMessageCreatorUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { name: 'Welcome' } as never, 'acc-1')
    ).rejects.toThrow('random_message_creation_failed');
  });

  it('creates random message using default active status', async () => {
    const randomMessageService = {
      createRandomMessage: jest.fn(async () => 'rm-1'),
    };
    const useCase = new RandomMessageCreatorUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        { name: ' Welcome ' } as never,
        'acc-1'
      )
    ).resolves.toBe('rm-1');
    expect(randomMessageService.createRandomMessage).toHaveBeenCalledWith({
      account_id: 'acc-1',
      name: 'Welcome',
      status: ERandomMessageStatus.active,
    });
  });

  it('creates random message preserving provided status', async () => {
    const randomMessageService = {
      createRandomMessage: jest.fn(async () => 'rm-2'),
    };
    const useCase = new RandomMessageCreatorUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        { name: 'Campaign', status: ERandomMessageStatus.inactive } as never,
        'acc-1'
      )
    ).resolves.toBe('rm-2');
    expect(randomMessageService.createRandomMessage).toHaveBeenCalledWith({
      account_id: 'acc-1',
      name: 'Campaign',
      status: ERandomMessageStatus.inactive,
    });
  });
});
