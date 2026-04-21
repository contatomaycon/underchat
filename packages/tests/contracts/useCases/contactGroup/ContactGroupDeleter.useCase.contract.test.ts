import 'reflect-metadata';

jest.mock('@core/services/contactGroup.service', () => ({
  ContactGroupService: class {},
}));

import { ContactGroupDeleterUseCase } from '@core/useCases/contactGroup/ContactGroupDeleter.useCase';

describe('ContactGroupDeleterUseCase', () => {
  it('throws when contact group does not exist', async () => {
    const service = {
      existsContactGroupById: jest.fn(async () => false),
      deleteContactGroup: jest.fn(),
    };
    const useCase = new ContactGroupDeleterUseCase(service as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'cg-1')).rejects.toThrow(
      'contact_group_not_found'
    );
    expect(service.deleteContactGroup).not.toHaveBeenCalled();
  });

  it('returns service deletion result when contact group exists', async () => {
    const service = {
      existsContactGroupById: jest.fn(async () => true),
      deleteContactGroup: jest.fn(async () => false),
    };
    const useCase = new ContactGroupDeleterUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, 'cg-1')).resolves.toBe(
      false
    );
  });
});
