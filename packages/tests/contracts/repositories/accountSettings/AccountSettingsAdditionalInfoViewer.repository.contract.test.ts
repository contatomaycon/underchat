import 'reflect-metadata';
import { AccountSettingsAdditionalInfoViewerRepository } from '@core/repositories/accountSettings/AccountSettingsAdditionalInfoViewer.repository';

describe('AccountSettingsAdditionalInfoViewerRepository', () => {
  it('returns mapped additional info when data exists', async () => {
    const repository = new AccountSettingsAdditionalInfoViewerRepository({
      query: {
        userInfo: {
          findFirst: jest.fn(async () => ({
            phone_ddi: '55',
            phone_partial: '***9999',
            name: 'John',
            last_name: 'Doe',
            birth_date: '1990-01-01',
            photo: 'photo.png',
          })),
        },
        userDocument: {
          findFirst: jest.fn(async () => ({
            document_partial: '***123',
            udt: {
              user_document_type_id: 'doc-type-1',
            },
          })),
        },
      },
    } as never);

    await expect(
      repository.viewAdditionalInfoByUserId('user-1')
    ).resolves.toEqual({
      phone_ddi: '55',
      phone_partial: '***9999',
      name: 'John',
      last_name: 'Doe',
      birth_date: '1990-01-01',
      photo: 'photo.png',
      document_type_id: 'doc-type-1',
      document_partial: '***123',
    });
  });

  it('returns null fields when no data exists', async () => {
    const repository = new AccountSettingsAdditionalInfoViewerRepository({
      query: {
        userInfo: {
          findFirst: jest.fn(async () => null),
        },
        userDocument: {
          findFirst: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(
      repository.viewAdditionalInfoByUserId('user-1')
    ).resolves.toEqual({
      phone_ddi: null,
      phone_partial: null,
      name: null,
      last_name: null,
      birth_date: null,
      photo: null,
      document_type_id: null,
      document_partial: null,
    });
  });
});
