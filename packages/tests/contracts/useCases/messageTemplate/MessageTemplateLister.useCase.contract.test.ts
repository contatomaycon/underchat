import 'reflect-metadata';

jest.mock('@core/services/messageTemplate.service', () => ({
  MessageTemplateService: class {},
}));

import { MessageTemplateListerUseCase } from '@core/useCases/messageTemplate/MessageTemplateLister.useCase';

describe('MessageTemplateListerUseCase', () => {
  it('uses default pagination when query values are missing', async () => {
    const service = {
      listMessageTemplates: jest.fn(async () => [[], 0]),
    };
    const useCase = new MessageTemplateListerUseCase(service as never);

    await expect(useCase.execute({} as never, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
  });

  it('uses query pagination and returns mapped response', async () => {
    const query = { per_page: 3, current_page: 2 } as never;
    const results = [{ message_template_id: 'mt-1' }];
    const service = {
      listMessageTemplates: jest.fn(async () => [results, 7]),
    };
    const useCase = new MessageTemplateListerUseCase(service as never);

    await expect(useCase.execute(query, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 3,
        per_page: 3,
        count: 1,
        total: 7,
      },
      results,
    });
  });
});
