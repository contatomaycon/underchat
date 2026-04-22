import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));

import { LabelTemplateUpdaterUseCase } from '@core/useCases/labelTemplate/LabelTemplateUpdater.useCase';

describe('LabelTemplateUpdaterUseCase', () => {
  it('throws when template does not exist', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => false),
      existsLabelStatusById: jest.fn(),
      updateLabelTemplateById: jest.fn(),
    };
    const useCase = new LabelTemplateUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'lt-1', {} as never)
    ).rejects.toThrow('label_template_not_found');
  });

  it('throws when provided label status does not exist', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => true),
      existsLabelStatusById: jest.fn(async () => false),
      updateLabelTemplateById: jest.fn(),
    };
    const useCase = new LabelTemplateUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'lt-1', {
        label_status: { label_status_id: 'ls-1' },
      } as never)
    ).rejects.toThrow('label_status_not_found');
  });

  it('throws when update fails', async () => {
    const service = {
      existsLabelTemplateById: jest.fn(async () => true),
      existsLabelStatusById: jest.fn(async () => true),
      updateLabelTemplateById: jest.fn(async () => false),
    };
    const useCase = new LabelTemplateUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn((k: string) => k) as never, 'lt-1', {
        label_status: { label_status_id: 'ls-1' },
      } as never)
    ).rejects.toThrow('label_template_update_error');
  });

  it('returns true when update succeeds without status validation', async () => {
    const input = { name: 'new' } as never;
    const service = {
      existsLabelTemplateById: jest.fn(async () => true),
      existsLabelStatusById: jest.fn(),
      updateLabelTemplateById: jest.fn(async () => true),
    };
    const useCase = new LabelTemplateUpdaterUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'lt-1', input)
    ).resolves.toBe(true);
    expect(service.existsLabelStatusById).not.toHaveBeenCalled();
  });
});
