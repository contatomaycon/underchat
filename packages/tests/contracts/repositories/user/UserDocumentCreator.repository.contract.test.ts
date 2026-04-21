import 'reflect-metadata';
import { UserDocumentCreatorRepository } from '@core/repositories/user/UserDocumentCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('UserDocumentCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as jest.Mock).mockReturnValue('document-id-1');
  });

  it('createUserDocument returns true when insert affects one row', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const values = jest.fn(() => ({ execute }));
    const tx = {
      insert: jest.fn(() => ({ values })),
    } as never;
    const repository = new UserDocumentCreatorRepository({} as never);

    await expect(
      repository.createUserDocument(
        tx,
        {
          user_document_type_id: 'doc-type-1',
          document: null,
          document_partial: null,
          document_c: null,
        },
        'user-1'
      )
    ).resolves.toBe(true);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        user_document_id: 'document-id-1',
        user_id: 'user-1',
        user_document_type_id: 'doc-type-1',
        document: null,
        document_partial: null,
        document_c: null,
      })
    );
  });

  it('createUserDocument returns false when insert affects zero rows', async () => {
    const repository = new UserDocumentCreatorRepository({} as never);
    const tx = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never;

    await expect(
      repository.createUserDocument(
        tx,
        { user_document_type_id: 'doc-type-1' } as never,
        'user-1'
      )
    ).resolves.toBe(false);
  });

  it('createUserDocumentWithoutTransaction returns true/false based on rowCount', async () => {
    const dbRw = {
      insert: jest
        .fn()
        .mockImplementationOnce(() => ({
          values: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        }))
        .mockImplementationOnce(() => ({
          values: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
    };
    const repository = new UserDocumentCreatorRepository(dbRw as never);

    await expect(
      repository.createUserDocumentWithoutTransaction(
        { user_document_type_id: 'doc-type-1' } as never,
        'user-1'
      )
    ).resolves.toBe(true);
    await expect(
      repository.createUserDocumentWithoutTransaction(
        { user_document_type_id: 'doc-type-1' } as never,
        'user-1'
      )
    ).resolves.toBe(false);
  });
});
