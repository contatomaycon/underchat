import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { ContactGroupAllListerUseCase } from '@core/useCases/contactGroup/ContactGroupAllLister.useCase';

describe('ContactGroupAllListerUseCase', () => {
  it('throws when account does not exist', async () => {
    const contactGroupService = { listContactGroupAll: jest.fn() };
    const accountService = {
      existsAccountById: jest.fn(async () => false),
    };
    const useCase = new ContactGroupAllListerUseCase(
      contactGroupService as never,
      accountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(contactGroupService.listContactGroupAll).not.toHaveBeenCalled();
  });

  it('returns all groups when account exists', async () => {
    const result = [{ contact_group_id: 'cg-1' }];
    const contactGroupService = {
      listContactGroupAll: jest.fn(async () => result),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const useCase = new ContactGroupAllListerUseCase(
      contactGroupService as never,
      accountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      result
    );
  });
});
