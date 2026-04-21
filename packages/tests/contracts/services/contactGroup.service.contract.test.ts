import 'reflect-metadata';
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
import { ContactGroupService } from '@core/services/contactGroup.service';

describe('ContactGroupService', () => {
  it('delegates list and CRUD methods', async () => {
    const listContactGroups = jest.fn(async () => [
      { contact_group_id: 'cg1' },
    ]);
    const listContactGroupTotal = jest.fn(async () => 4);

    const service = new ContactGroupService(
      { listContactGroups, listContactGroupTotal } as never,
      {
        listContactGroupAll: jest.fn(async () => [{ contact_group_id: 'cg1' }]),
      } as never,
      { createContactGroup: jest.fn(async () => true) } as never,
      { existsContactGroupById: jest.fn(async () => true) } as never,
      {
        viewContactGroupById: jest.fn(async () => ({
          contact_group_id: 'cg1',
        })),
      } as never,
      { deleteContactGroup: jest.fn(async () => true) } as never,
      { updateContactGroup: jest.fn(async () => true) } as never
    );

    await expect(
      service.listContactGroups(10, 1, {} as never, 'a1')
    ).resolves.toEqual([[{ contact_group_id: 'cg1' }], 4]);
    await expect(service.listContactGroupAll('a1')).resolves.toEqual([
      { contact_group_id: 'cg1' },
    ]);
    await expect(
      service.createContactGroup(((k: string) => k) as never, 'a1', {} as never)
    ).resolves.toBe(true);
    await expect(service.existsContactGroupById('cg1')).resolves.toBe(true);
    await expect(service.viewContactGroupById('cg1')).resolves.toEqual({
      contact_group_id: 'cg1',
    });
    await expect(
      service.deleteContactGroup(((k: string) => k) as never, 'cg1')
    ).resolves.toBe(true);
    await expect(
      service.updateContactGroupById(
        ((k: string) => k) as never,
        'cg1',
        {} as never
      )
    ).resolves.toBe(true);
  });
});
