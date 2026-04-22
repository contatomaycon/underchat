import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { LabelTemplateCreatorUseCase } from '@core/useCases/labelTemplate/LabelTemplateCreator.useCase';

describe('LabelTemplateCreatorUseCase', () => {
  it('throws when account does not exist', async () => {
    const labelTemplateService = {
      existsLabelStatusById: jest.fn(),
      createLabelTemplate: jest.fn(),
    };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const useCase = new LabelTemplateCreatorUseCase(
      labelTemplateService as never,
      accountService as never
    );

    await expect(
      useCase.execute(
        jest.fn((k: string) => k) as never,
        { label_status: { label_status_id: 'ls-1' } } as never,
        'acc-1'
      )
    ).rejects.toThrow('account_not_found');
  });

  it('throws when label status does not exist', async () => {
    const labelTemplateService = {
      existsLabelStatusById: jest.fn(async () => false),
      createLabelTemplate: jest.fn(),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new LabelTemplateCreatorUseCase(
      labelTemplateService as never,
      accountService as never
    );

    await expect(
      useCase.execute(
        jest.fn((k: string) => k) as never,
        { label_status: { label_status_id: 'ls-1' } } as never,
        'acc-1'
      )
    ).rejects.toThrow('label_status_not_found');
  });

  it('throws when creation fails', async () => {
    const labelTemplateService = {
      existsLabelStatusById: jest.fn(async () => true),
      createLabelTemplate: jest.fn(async () => false),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new LabelTemplateCreatorUseCase(
      labelTemplateService as never,
      accountService as never
    );

    await expect(
      useCase.execute(
        jest.fn((k: string) => k) as never,
        { label_status: { label_status_id: 'ls-1' } } as never,
        'acc-1'
      )
    ).rejects.toThrow('label_template_creation_failed');
  });

  it('returns true when creation succeeds', async () => {
    const input = { label_status: { label_status_id: 'ls-1' } } as never;
    const labelTemplateService = {
      existsLabelStatusById: jest.fn(async () => true),
      createLabelTemplate: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new LabelTemplateCreatorUseCase(
      labelTemplateService as never,
      accountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, input, 'acc-1')
    ).resolves.toBe(true);
    expect(labelTemplateService.createLabelTemplate).toHaveBeenCalledWith(
      input,
      'acc-1'
    );
  });
});
