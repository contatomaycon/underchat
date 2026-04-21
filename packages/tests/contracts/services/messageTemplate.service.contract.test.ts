import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { MessageTemplateService } from '@core/services/messageTemplate.service';

describe('MessageTemplateService', () => {
  it('delegates list and CRUD methods', async () => {
    const listMessageTemplates = jest.fn(async () => [
      { message_template_id: 'm1' },
    ]);
    const listMessageTemplateTotal = jest.fn(async () => 5);

    const service = new MessageTemplateService(
      { listMessageTemplates, listMessageTemplateTotal } as never,
      { createMessageTemplate: jest.fn(async () => 'm1') } as never,
      { existsMessageStatusById: jest.fn(async () => true) } as never,
      { existsMessageTemplateById: jest.fn(async () => true) } as never,
      {
        viewMessageTemplateById: jest.fn(async () => ({
          message_template_id: 'm1',
        })),
      } as never,
      { deleteMessageTemplateById: jest.fn(async () => true) } as never,
      { updateMessageTemplateById: jest.fn(async () => true) } as never
    );

    await expect(
      service.listMessageTemplates(10, 1, { query: 'x' } as never, 'a1')
    ).resolves.toEqual([[{ message_template_id: 'm1' }], 5]);
    await expect(service.createMessageTemplate({} as never)).resolves.toBe(
      'm1'
    );
    await expect(service.existsMessageStatusById('s1')).resolves.toBe(true);
    await expect(service.existsMessageTemplateById('m1')).resolves.toBe(true);
    await expect(service.viewMessageTemplateById('m1')).resolves.toEqual({
      message_template_id: 'm1',
    });
    await expect(service.deleteMessageTemplateById('m1')).resolves.toBe(true);
    await expect(service.updateMessageTemplateById({} as never)).resolves.toBe(
      true
    );
  });
});
