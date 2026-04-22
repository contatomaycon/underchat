import 'reflect-metadata';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));

import { MessageTemplateChannelsListerUseCase } from '@core/useCases/messageTemplate/MessageTemplateChannelsLister.useCase';

describe('MessageTemplateChannelsListerUseCase', () => {
  it('returns all channels when user channels filter is empty', async () => {
    const workers = [
      { id: 'wk-1', name: 'A', number: '111' },
      { id: 'wk-2', name: 'B', number: null },
    ];
    const service = {
      listAllWorkers: jest.fn(async () => workers),
    };
    const useCase = new MessageTemplateChannelsListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(workers);
  });

  it('filters channels by userChannels when provided', async () => {
    const workers = [
      { id: 'wk-1', name: 'A', number: '111' },
      { id: 'wk-2', name: 'B', number: null },
    ];
    const service = {
      listAllWorkers: jest.fn(async () => workers),
    };
    const useCase = new MessageTemplateChannelsListerUseCase(service as never);

    await expect(
      useCase.execute('acc-1', [{ id: 'wk-2', name: 'Worker 2' }])
    ).resolves.toEqual([{ id: 'wk-2', name: 'B', number: null }]);
  });
});
