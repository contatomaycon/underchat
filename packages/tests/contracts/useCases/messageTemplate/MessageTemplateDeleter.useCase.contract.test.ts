import 'reflect-metadata';

jest.mock('@core/services/messageTemplate.service', () => ({
  MessageTemplateService: class {},
}));

import { MessageTemplateDeleterUseCase } from '@core/useCases/messageTemplate/MessageTemplateDeleter.useCase';

describe('MessageTemplateDeleterUseCase', () => {
  it('throws when template does not exist', async () => {
    const service = {
      existsMessageTemplateById: jest.fn(async () => false),
      deleteMessageTemplateById: jest.fn(),
    };
    const useCase = new MessageTemplateDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'mt-1')
    ).rejects.toThrow('message_template_not_found');
  });

  it('delegates deletion when template exists', async () => {
    const service = {
      existsMessageTemplateById: jest.fn(async () => true),
      deleteMessageTemplateById: jest.fn(async () => true),
    };
    const useCase = new MessageTemplateDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'mt-1')).resolves.toBe(
      true
    );
    expect(service.deleteMessageTemplateById).toHaveBeenCalledWith('mt-1');
  });
});
