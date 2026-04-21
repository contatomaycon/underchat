import 'reflect-metadata';
import { UserDocumentUpdaterRepository } from '@core/repositories/user/UserDocumentUpdater.repository';

describe('UserDocumentUpdaterRepository', () => {
  it('updateInput maps document fields and ignores null document type id', () => {
    const repository = new UserDocumentUpdaterRepository({} as never);

    const updateInput = (repository as any).updateInput({
      user_document_type_id: null,
      document: 'doc',
      document_partial: 'doc-partial',
      document_c: 'doc-c',
    });

    expect(updateInput).toEqual({
      document: 'doc',
      document_partial: 'doc-partial',
      document_c: 'doc-c',
    });
  });

  it('updateUserDocumentById returns false when payload has no fields', async () => {
    const repository = new UserDocumentUpdaterRepository({} as never);

    await expect(
      repository.updateUserDocumentById('user-1', {} as never)
    ).resolves.toBe(false);
  });

  it('updateUserDocumentById returns true when rowCount is one', async () => {
    const repository = new UserDocumentUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 1 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateUserDocumentById('user-1', { document: 'doc' } as never)
    ).resolves.toBe(true);
  });

  it('deleteUserDocumentById returns true on non-negative rowCount', async () => {
    const repository = new UserDocumentUpdaterRepository({
      delete: jest.fn(() => ({
        where: jest.fn(() => ({
          execute: jest.fn(async () => ({ rowCount: 0 })),
        })),
      })),
    } as never);

    await expect(repository.deleteUserDocumentById('user-1')).resolves.toBe(
      true
    );
  });

  it('existsUserDocumentByUserId returns true when row exists and false otherwise', async () => {
    const dbRw = {
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                execute: jest.fn(async () => [{ user_document_id: 'doc-1' }]),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                execute: jest.fn(async () => []),
              })),
            })),
          })),
        })),
    };
    const repository = new UserDocumentUpdaterRepository(dbRw as never);

    await expect(repository.existsUserDocumentByUserId('user-1')).resolves.toBe(
      true
    );
    await expect(repository.existsUserDocumentByUserId('user-1')).resolves.toBe(
      false
    );
  });
});
