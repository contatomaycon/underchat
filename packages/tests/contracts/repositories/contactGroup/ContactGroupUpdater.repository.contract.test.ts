import 'reflect-metadata';
import { ContactGroupUpdaterRepository } from '@core/repositories/contactGroup/ContactGroupUpdater.repository';

describe('ContactGroupUpdaterRepository', () => {
  it('updates contact group data and returns status', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const tx = {
      update: jest.fn(() => ({ set })),
    };
    const repository = new ContactGroupUpdaterRepository({} as never);

    await expect(
      repository.updateContactGroupById(tx as never, 'cg-1', {
        name: 'VIP',
        description: 'd',
      } as never)
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ name: 'VIP', description: 'd' });
  });

  it('returns false when update affects zero rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const tx = {
      update: jest.fn(() => ({ set })),
    };
    const repository = new ContactGroupUpdaterRepository({} as never);

    await expect(
      repository.updateContactGroupById(tx as never, 'cg-1', {
        name: 'VIP',
      } as never)
    ).resolves.toBe(false);
  });
});
