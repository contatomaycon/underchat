import 'reflect-metadata';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';

describe('ContactLabelTemplateDeleterRepository', () => {
  it('deletes label templates by contact in transaction', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const tx = { delete: del };

    const repository = new ContactLabelTemplateDeleterRepository({} as never);

    await expect(
      repository.deleteContactLabelTemplatesByContactId(
        tx as never,
        'contact-1'
      )
    ).resolves.toBe(true);
  });

  it('returns false when deleting by contact and label affects no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const dbRw = { delete: del };

    const repository = new ContactLabelTemplateDeleterRepository(dbRw as never);

    await expect(
      repository.deleteContactLabelTemplateByContactIdAndLabelTemplateId(
        'contact-1',
        'label-1'
      )
    ).resolves.toBe(false);
  });
});
