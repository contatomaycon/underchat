import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { WebhookMappingViewerUseCase } from '@core/useCases/integration/WebhookMappingViewer.useCase';

describe('WebhookMappingViewerUseCase', () => {
  it('delegates mapping view', async () => {
    const result = {
      account_id: 'acc-1',
      worker_id: 'wk-1',
      mapping: { foo: 'bar' },
    };
    const service = {
      viewWebhookMapping: jest.fn(async () => result),
    };
    const useCase = new WebhookMappingViewerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toEqual(result);
    expect(service.viewWebhookMapping).toHaveBeenCalledWith('acc-1', 'key-1');
  });

  it('returns null when no mapping exists', async () => {
    const service = {
      viewWebhookMapping: jest.fn(async () => null),
    };
    const useCase = new WebhookMappingViewerUseCase(service as never);

    await expect(useCase.execute('acc-1', 'key-1')).resolves.toBeNull();
  });
});
