import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));

import { LabelTemplateDeleterUseCase } from '@core/useCases/labelTemplate/LabelTemplateDeleter.useCase';

describe('LabelTemplateDeleterUseCase', () => {
  it('throws when label template does not exist', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => false),
      deleteLabelTemplateById: jest.fn(),
    };
    const useCase = new LabelTemplateDeleterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'lt-1')
    ).rejects.toThrow('label_template_not_found');
  });

  it('delegates delete when label template exists', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => true),
      deleteLabelTemplateById: jest.fn(async () => true),
    };
    const useCase = new LabelTemplateDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'lt-1')).resolves.toBe(
      true
    );
    expect(service.deleteLabelTemplateById).toHaveBeenCalledWith('lt-1');
  });
});
