import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));
jest.mock('@core/services/contact.service', () => ({
  ContactService: class {},
}));

import { ContactGroupUpdaterUseCase } from '@core/useCases/contactGroup/ContactGroupUpdater.useCase';

describe('ContactGroupUpdaterUseCase', () => {
  it('throws when contact group does not exist', async () => {
    const contactGroupService = {
      viewContactGroupById: jest.fn(async () => null),
      updateContactGroupById: jest.fn(),
    };
    const contactService = { existsContactById: jest.fn() };
    const useCase = new ContactGroupUpdaterUseCase(
      contactGroupService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'cg-1', {} as never)
    ).rejects.toThrow('contact_group_not_found');
  });

  it('throws when one of the provided contacts does not exist', async () => {
    const contactGroupService = {
      viewContactGroupById: jest.fn(async () => ({ contact_group_id: 'cg-1' })),
      updateContactGroupById: jest.fn(),
    };
    const contactService = {
      existsContactById: jest.fn(async () => false),
    };
    const useCase = new ContactGroupUpdaterUseCase(
      contactGroupService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'cg-1', {
        contacts: [{ contact_id: 'c-1' }],
      } as never)
    ).rejects.toThrow('contact_not_found');
    expect(contactGroupService.updateContactGroupById).not.toHaveBeenCalled();
  });

  it('throws when update returns false', async () => {
    const contactGroupService = {
      viewContactGroupById: jest.fn(async () => ({ contact_group_id: 'cg-1' })),
      updateContactGroupById: jest.fn(async () => false),
    };
    const contactService = { existsContactById: jest.fn(async () => true) };
    const useCase = new ContactGroupUpdaterUseCase(
      contactGroupService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'cg-1', {
        contacts: [{ contact_id: 'c-1' }],
      } as never)
    ).rejects.toThrow('contact_group_update_error');
  });

  it('returns true when update succeeds', async () => {
    const body = { contacts: [{ contact_id: 'c-1' }, {}] } as never;
    const contactGroupService = {
      viewContactGroupById: jest.fn(async () => ({ contact_group_id: 'cg-1' })),
      updateContactGroupById: jest.fn(async () => true),
    };
    const contactService = { existsContactById: jest.fn(async () => true) };
    const useCase = new ContactGroupUpdaterUseCase(
      contactGroupService as never,
      contactService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'cg-1', body)).resolves.toBe(true);
    expect(contactGroupService.updateContactGroupById).toHaveBeenCalledWith(
      t,
      'cg-1',
      body
    );
  });
});
