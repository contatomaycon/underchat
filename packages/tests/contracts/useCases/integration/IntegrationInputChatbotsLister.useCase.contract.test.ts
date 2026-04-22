import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { IntegrationInputChatbotsListerUseCase } from '@core/useCases/integration/IntegrationInputChatbotsLister.useCase';

describe('IntegrationInputChatbotsListerUseCase', () => {
  it('delegates input chatbots listing', async () => {
    const result = { chatbots: [] };
    const service = {
      listInputChatbotsForWebhook: jest.fn(async () => result),
    };
    const useCase = new IntegrationInputChatbotsListerUseCase(service as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(result);
    expect(service.listInputChatbotsForWebhook).toHaveBeenCalledWith('acc-1');
  });
});
