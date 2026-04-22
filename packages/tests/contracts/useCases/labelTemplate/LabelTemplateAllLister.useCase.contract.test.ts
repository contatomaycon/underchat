import 'reflect-metadata';

jest.mock('@core/services/labelTemplate.service', () => ({
  LabelTemplateService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { LabelTemplateAllListerUseCase } from '@core/useCases/labelTemplate/LabelTemplateAllLister.useCase';

describe('LabelTemplateAllListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const labelTemplateService = { listLabelTemplateAll: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const useCase = new LabelTemplateAllListerUseCase(
      labelTemplateService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(labelTemplateService.listLabelTemplateAll).not.toHaveBeenCalled();
  });

  it('returns labels when account exists', async () => {
    const labels = [{ label_template_id: 'lt-1' }];
    const labelTemplateService = {
      listLabelTemplateAll: jest.fn(async () => labels),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const useCase = new LabelTemplateAllListerUseCase(
      labelTemplateService as never,
      accountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      labels
    );
  });
});
