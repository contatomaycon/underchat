import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { WebhookDataViewerUseCase } from '@core/useCases/integration/WebhookDataViewer.useCase';

describe('WebhookDataViewerUseCase', () => {
  it('delegates webhook data view', async () => {
    const result = { config: {} };
    const service = {
      viewWebhookData: jest.fn(async () => result),
    };
    const useCase = new WebhookDataViewerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toEqual(result);
    expect(service.viewWebhookData).toHaveBeenCalledWith('acc-1', 'key-1');
  });

  it('returns null when webhook data is unavailable', async () => {
    const service = {
      viewWebhookData: jest.fn(async () => null),
    };
    const useCase = new WebhookDataViewerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBeNull();
  });
});
