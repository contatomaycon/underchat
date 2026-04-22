import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageViewerUseCase } from '@core/useCases/randomMessage/RandomMessageViewer.useCase';

describe('RandomMessageViewerUseCase', () => {
  it('throws when random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
    };
    const useCase = new RandomMessageViewerUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'rm-1', 'acc-1')).rejects.toThrow(
      'random_message_not_found'
    );
  });

  it('returns random message by id', async () => {
    const randomMessage = { random_message_id: 'rm-1', name: 'Campaign' };
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => randomMessage),
    };
    const useCase = new RandomMessageViewerUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', 'acc-1')
    ).resolves.toEqual(randomMessage);
  });
});
