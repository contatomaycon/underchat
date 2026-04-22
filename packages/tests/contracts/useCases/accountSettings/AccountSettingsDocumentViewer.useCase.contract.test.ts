import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsDocumentViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsDocumentViewer.useCase';

describe('AccountSettingsDocumentViewerUseCase', () => {
  it('throws when user does not exist', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => null),
      getUserDocumentDecrypted: jest.fn(),
    };
    const useCase = new AccountSettingsDocumentViewerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
    expect(userService.getUserDocumentDecrypted).not.toHaveBeenCalled();
  });

  it('returns decrypted document', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => ({ document: 'enc-doc' })),
      getUserDocumentDecrypted: jest.fn(() => '12345678900'),
    };
    const useCase = new AccountSettingsDocumentViewerUseCase(
      userService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual({
      document: '12345678900',
    });
    expect(userService.getUserDocumentDecrypted).toHaveBeenCalledWith(
      'enc-doc'
    );
  });
});
