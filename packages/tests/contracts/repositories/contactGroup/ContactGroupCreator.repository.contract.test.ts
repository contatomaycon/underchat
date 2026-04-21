import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactGroupCreatorRepository } from '@core/repositories/contactGroup/ContactGroupCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ContactGroupCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('cg-1');
  });

  it('creates contact group in transaction', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new ContactGroupCreatorRepository({} as never);

    await expect(
      repository.createContactGroup(
        tx as never,
        { name: 'VIP', description: 'd' } as never,
        'acc-1'
      )
    ).resolves.toBe('cg-1');
  });

  it('returns null when insert returns empty', async () => {
    const execute = jest.fn(async () => null);
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new ContactGroupCreatorRepository({} as never);

    await expect(
      repository.createContactGroup(
        tx as never,
        { name: 'VIP', description: 'd' } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
  });
});
