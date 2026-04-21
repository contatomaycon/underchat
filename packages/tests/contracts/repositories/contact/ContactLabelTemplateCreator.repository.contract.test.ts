import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactLabelTemplateCreatorRepository } from '@core/repositories/contact/ContactLabelTemplateCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ContactLabelTemplateCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue(
      'contact-label-template-id'
    );
  });

  it('creates label template in transaction and returns id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const tx = { insert };

    const repository = new ContactLabelTemplateCreatorRepository({} as never);

    await expect(
      repository.createContactLabelTemplate(tx as never, 'contact-1', 'label-1')
    ).resolves.toBe('contact-label-template-id');
  });

  it('returns null when transaction insert does not return result', async () => {
    const execute = jest.fn(async () => null);
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const tx = { insert };

    const repository = new ContactLabelTemplateCreatorRepository({} as never);

    await expect(
      repository.createContactLabelTemplate(tx as never, 'contact-1', 'label-1')
    ).resolves.toBeNull();
  });

  it('creates label template without transaction and returns id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const insert = jest.fn(() => ({ values }));
    const dbRw = { insert };

    const repository = new ContactLabelTemplateCreatorRepository(dbRw as never);

    await expect(
      repository.createContactLabelTemplateWithoutTransaction(
        'contact-1',
        'label-1'
      )
    ).resolves.toBe('contact-label-template-id');
  });
});
