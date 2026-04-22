import 'reflect-metadata';

jest.mock('@core/services/messageTemplate.service', () => ({
  MessageTemplateService: class {},
}));

import { MessageTemplateViewerUseCase } from '@core/useCases/messageTemplate/MessageTemplateViewer.useCase';

describe('MessageTemplateViewerUseCase', () => {
  it('throws when template does not exist', async () => {
    const service = {
      existsMessageTemplateById: jest.fn(async () => false),
      viewMessageTemplateById: jest.fn(),
    };
    const useCase = new MessageTemplateViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'mt-1')
    ).rejects.toThrow('message_template_not_found');
  });

  it('returns template when it exists', async () => {
    const template = { message_template_id: 'mt-1' };
    const service = {
      existsMessageTemplateById: jest.fn(async () => true),
      viewMessageTemplateById: jest.fn(async () => template),
    };
    const useCase = new MessageTemplateViewerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'mt-1')).resolves.toEqual(
      template
    );
  });
});
