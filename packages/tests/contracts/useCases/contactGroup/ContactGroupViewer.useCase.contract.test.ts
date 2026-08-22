import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));

import { ContactGroupViewerUseCase } from '@core/useCases/contactGroup/ContactGroupViewer.useCase';

describe('ContactGroupViewerUseCase', () => {
  it('throws when contact group does not exist', async () => {
    const service = {
      existsContactGroupById: jest.fn(async () => false),
      viewContactGroupById: jest.fn(),
    };
    const useCase = new ContactGroupViewerUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'cg-1', 'account-1')
    ).rejects.toThrow('contact_group_not_found');
    expect(service.viewContactGroupById).not.toHaveBeenCalled();
  });

  it('returns contact group details when exists', async () => {
    const result = { contact_group_id: 'cg-1' };
    const service = {
      existsContactGroupById: jest.fn(async () => true),
      viewContactGroupById: jest.fn(async () => result),
    };
    const useCase = new ContactGroupViewerUseCase(service as never);

    await expect(
      useCase.execute(jest.fn() as never, 'cg-1', 'account-1')
    ).resolves.toEqual(result);
  });
});
