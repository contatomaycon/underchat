import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));

import { LabelTemplateListerUseCase } from '@core/useCases/labelTemplate/LabelTemplateLister.useCase';

describe('LabelTemplateListerUseCase', () => {
  it('uses default pagination when query is empty', async () => {
    const service = {
      listLabelTemplates: jest.fn(async () => [[], 0]),
    };
    const useCase = new LabelTemplateListerUseCase(service as never);

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
    const query = { per_page: 5, current_page: 2 } as never;
    const results = [{ label_template_id: 'lt-1' }];
    const service = {
      listLabelTemplates: jest.fn(async () => [results, 6]),
    };
    const useCase = new LabelTemplateListerUseCase(service as never);

    await expect(useCase.execute(query, 'acc-1')).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 5,
        count: 1,
        total: 6,
      },
      results,
    });
  });
});
