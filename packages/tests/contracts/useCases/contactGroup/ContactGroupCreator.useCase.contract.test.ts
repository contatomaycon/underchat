import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/contact.service', () => ({
  ContactService: class {},
}));

import { ContactGroupCreatorUseCase } from '@core/useCases/contactGroup/ContactGroupCreator.useCase';

describe('ContactGroupCreatorUseCase', () => {
  it('throws when account does not exist', async () => {
    const contactGroupService = { createContactGroup: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const contactService = { existsContactById: jest.fn() };
    const useCase = new ContactGroupCreatorUseCase(
      contactGroupService as never,
      accountService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, {} as never, 'acc-1')
    ).rejects.toThrow('account_not_found');
  });

  it('throws when a provided contact does not exist', async () => {
    const contactGroupService = { createContactGroup: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const contactService = {
      existsContactById: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const useCase = new ContactGroupCreatorUseCase(
      contactGroupService as never,
      accountService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          contacts: [{ contact_id: 'c-1' }, { contact_id: 'c-2' }],
        } as never,
        'acc-1'
      )
    ).rejects.toThrow('contact_not_found');
    expect(contactGroupService.createContactGroup).not.toHaveBeenCalled();
  });

  it('throws when contact group creation fails', async () => {
    const contactGroupService = {
      createContactGroup: jest.fn(async () => false),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const contactService = { existsContactById: jest.fn(async () => true) };
    const useCase = new ContactGroupCreatorUseCase(
      contactGroupService as never,
      accountService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        { contacts: [{ contact_id: 'c-1' }, {}] } as never,
        'acc-1'
      )
    ).rejects.toThrow('contact_group_creation_failed');
  });

  it('returns true when creation succeeds', async () => {
    const input = { contacts: [{ contact_id: 'c-1' }] } as never;
    const contactGroupService = {
      createContactGroup: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const contactService = { existsContactById: jest.fn(async () => true) };
    const useCase = new ContactGroupCreatorUseCase(
      contactGroupService as never,
      accountService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, input, 'acc-1')).resolves.toBe(
      true
    );
    expect(contactGroupService.createContactGroup).toHaveBeenCalledWith(
      t,
      'acc-1',
      input
    );
  });
});
