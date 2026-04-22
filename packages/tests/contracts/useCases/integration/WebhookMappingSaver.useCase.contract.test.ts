import 'reflect-metadata';

jest.mock('@core/services/integration.service', () => ({
  IntegrationService: class {},
}));

import { WebhookMappingSaverUseCase } from '@core/useCases/integration/WebhookMappingSaver.useCase';
import { WebhookMappingValidationError } from '@core/common/exceptions/WebhookMappingValidationError';

describe('WebhookMappingSaverUseCase', () => {
  it('throws validation error when chatbot mapping has empty chatbot_id', async () => {
    const service = { saveWebhookMapping: jest.fn() };
    const useCase = new WebhookMappingSaverUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'key-1', {
        message_type: 'chatbot',
        chatbot_id: '  ',
      })
    ).rejects.toBeInstanceOf(WebhookMappingValidationError);

    expect(service.saveWebhookMapping).not.toHaveBeenCalled();
  });

  it('throws validation error when transfer sector user is set without transfer sector', async () => {
    const service = { saveWebhookMapping: jest.fn() };
    const useCase = new WebhookMappingSaverUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'key-1', {
        message_type: 'message',
        transfer_sector_user_id: 'user-1',
      })
    ).rejects.toBeInstanceOf(WebhookMappingValidationError);

    expect(service.saveWebhookMapping).not.toHaveBeenCalled();
  });

  it('throws validation error when transfer user is blank', async () => {
    const service = { saveWebhookMapping: jest.fn() };
    const useCase = new WebhookMappingSaverUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'key-1', {
        message_type: 'message',
        transfer_user_id: ' ',
      })
    ).rejects.toBeInstanceOf(WebhookMappingValidationError);

    expect(service.saveWebhookMapping).not.toHaveBeenCalled();
  });

  it('throws generic error when save operation fails', async () => {
    const service = { saveWebhookMapping: jest.fn(async () => false) };
    const useCase = new WebhookMappingSaverUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', 'key-1', {
        message_type: 'message',
        transfer_sector_id: 'sec-1',
      })
    ).rejects.toThrow('webhook_mapping_save_error');
  });

  it('saves mapping when message_type is not a string', async () => {
    const mapping = { message_type: ['chatbot'], any: 'value' } as Record<
      string,
      string | string[]
    >;
    const service = { saveWebhookMapping: jest.fn(async () => true) };
    const useCase = new WebhookMappingSaverUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'key-1', mapping)
    ).resolves.toBe(true);

    expect(service.saveWebhookMapping).toHaveBeenCalledWith(
      'acc-1',
      'key-1',
      mapping
    );
  });

  it('saves valid chatbot mapping', async () => {
    const mapping = {
      message_type: 'chatbot',
      chatbot_id: 'bot-1',
    };
    const service = { saveWebhookMapping: jest.fn(async () => true) };
    const useCase = new WebhookMappingSaverUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', 'key-1', mapping)
    ).resolves.toBe(true);
  });
});
