import 'reflect-metadata';

jest.mock('@core/repositories/apiKey/ApiKeyViewer.repository', () => ({
  ApiKeyViewerRepository: class {},
}));
jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('@core/services/planEntitlement.service', () => ({
  PlanEntitlementService: class {},
}));

import { WebhookReceiverUseCase } from '@core/useCases/webhook/WebhookReceiver.useCase';

describe('WebhookReceiverUseCase', () => {
  const revision = '7';
  const createEntitlementService = () => ({
    assertEntitled: jest.fn(async () => ({ revision })),
  });

  it('returns false when api key data is missing', async () => {
    const apiKeyViewerRepository = {
      viewApiKeyById: jest.fn(async () => null),
    };
    const integrationService = {
      processWebhook: jest.fn(),
    };

    const useCase = new WebhookReceiverUseCase(
      apiKeyViewerRepository as never,
      integrationService as never,
      createEntitlementService() as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        { api_key_id: 'key-1', account_id: 'acc-1' } as never,
        { payload: true } as never,
        revision
      )
    ).resolves.toBe(false);

    expect(integrationService.processWebhook).not.toHaveBeenCalled();
  });

  it('returns false when api key has no worker id', async () => {
    const apiKeyViewerRepository = {
      viewApiKeyById: jest.fn(async () => ({ worker_id: null })),
    };
    const integrationService = {
      processWebhook: jest.fn(),
    };

    const useCase = new WebhookReceiverUseCase(
      apiKeyViewerRepository as never,
      integrationService as never,
      createEntitlementService() as never
    );

    await expect(
      useCase.execute(
        jest.fn() as never,
        { api_key_id: 'key-1', account_id: 'acc-1' } as never,
        { payload: true } as never,
        revision
      )
    ).resolves.toBe(false);

    expect(integrationService.processWebhook).not.toHaveBeenCalled();
  });

  it('delegates webhook processing when api key has worker id', async () => {
    const apiKeyViewerRepository = {
      viewApiKeyById: jest.fn(async () => ({ worker_id: 'wk-1' })),
    };
    const integrationService = {
      processWebhook: jest.fn(async () => true),
    };

    const entitlementService = createEntitlementService();
    const useCase = new WebhookReceiverUseCase(
      apiKeyViewerRepository as never,
      integrationService as never,
      entitlementService as never
    );

    const t = jest.fn((key: string) => key);
    const body = { payload: true };
    const operationId = 'request-operation-1';

    await expect(
      useCase.execute(
        t as never,
        { api_key_id: 'key-1', account_id: 'acc-1' } as never,
        body as never,
        revision,
        operationId
      )
    ).resolves.toBe(true);

    expect(integrationService.processWebhook).toHaveBeenCalledWith(
      t,
      'acc-1',
      'wk-1',
      body,
      revision,
      operationId
    );
    expect(entitlementService.assertEntitled).toHaveBeenCalledWith(
      'acc-1',
      expect.any(String),
      { expectedRevision: revision }
    );
  });
});
