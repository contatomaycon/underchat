import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));

import { LabelTemplateViewerUseCase } from '@core/useCases/labelTemplate/LabelTemplateViewer.useCase';

describe('LabelTemplateViewerUseCase', () => {
  it('throws when label template does not exist', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => false),
      viewLabelTemplateById: jest.fn(),
    };
    const useCase = new LabelTemplateViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'lt-1')
    ).rejects.toThrow('label_template_not_found');
  });

  it('returns label template when it exists', async () => {
    const template = { label_template_id: 'lt-1' };
    const service = {
      existsLabelTemplateById: jest.fn(async () => true),
      viewLabelTemplateById: jest.fn(async () => template),
    };
    const useCase = new LabelTemplateViewerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'lt-1')).resolves.toEqual(
      template
    );
  });
});
