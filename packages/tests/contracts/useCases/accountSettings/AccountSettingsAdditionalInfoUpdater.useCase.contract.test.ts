import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class {},
}));

import { AccountSettingsAdditionalInfoUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsAdditionalInfoUpdater.useCase';

describe('AccountSettingsAdditionalInfoUpdaterUseCase', () => {
  const buildUseCase = (overrides: Record<string, unknown> = {}) => {
    const userService = {
      existsUserByPhone: jest.fn(async () => false),
      updateUserInfoById: jest.fn(async () => true),
      existsUserDocumentByUserId: jest.fn(async () => false),
      deleteUserDocumentById: jest.fn(async () => undefined),
      createUserDocumentWithoutTransaction: jest.fn(async () => true),
      updateUserDocumentById: jest.fn(async () => true),
      ...overrides,
    };
    const encryptService = {
      sanitize: jest.fn((value: string) => `partial-${value}`),
      encrypt: jest.fn((value: string) => `enc-${value}`),
    };
    const passwordEncryptorService = {
      encrypt: jest.fn((value: string) => `hash-${value}`),
    };
    const useCase = new AccountSettingsAdditionalInfoUpdaterUseCase(
      userService as never,
      encryptService as never,
      passwordEncryptorService as never
    );

    return {
      useCase,
      userService,
      encryptService,
      passwordEncryptorService,
    };
  };

  it('returns success when request has no user info or document fields', async () => {
    const { useCase, userService } = buildUseCase();

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {} as never)
    ).resolves.toEqual({ success: true });
    expect(userService.updateUserInfoById).not.toHaveBeenCalled();
    expect(userService.existsUserDocumentByUserId).not.toHaveBeenCalled();
  });

  it('throws on invalid birth date format', async () => {
    const { useCase } = buildUseCase();
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', { birth_date: 'invalid' } as never)
    ).rejects.toThrow('invalid_birth_date');
  });

  it('throws when birth date is in the future', async () => {
    const { useCase } = buildUseCase();
    const t = jest.fn((key: string) => key);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    await expect(
      useCase.execute(t as never, 'user-1', { birth_date: tomorrow } as never)
    ).rejects.toThrow('birth_date_cannot_be_future');
  });

  it('throws when phone already exists for another user', async () => {
    const { useCase, userService } = buildUseCase({
      existsUserByPhone: jest.fn(async () => true),
    });
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', { phone: '5511999999999' } as never)
    ).rejects.toThrow('user_already_exists_phone');
    expect(userService.updateUserInfoById).not.toHaveBeenCalled();
  });

  it('throws when user info update fails', async () => {
    const { useCase } = buildUseCase({
      updateUserInfoById: jest.fn(async () => false),
    });
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', { name: 'Maycon' } as never)
    ).rejects.toThrow('user_info_update_failed');
  });

  it('updates user info with encrypted phone and sanitized values', async () => {
    const { useCase, userService } = buildUseCase();
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', {
        phone_ddi: '+55',
        phone: '5511999999999',
        name: 'Maycon',
        last_name: 'Silva',
        birth_date: '2024-01-01',
      } as never)
    ).resolves.toEqual({ success: true });

    expect(userService.existsUserByPhone).toHaveBeenCalledWith(
      'enc-5511999999999',
      'user-1'
    );
    expect(userService.updateUserInfoById).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        phone_ddi: '+55',
        phone: 'hash-5511999999999',
        phone_partial: 'partial-5511999999999',
        phone_c: 'enc-5511999999999',
        name: 'Maycon',
        last_name: 'Silva',
        birth_date: '2024-01-01',
      })
    );
  });

  it('clears existing document when empty document type is provided', async () => {
    const { useCase, userService } = buildUseCase({
      existsUserDocumentByUserId: jest.fn(async () => true),
    });

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        document_type_id: '',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.deleteUserDocumentById).toHaveBeenCalledWith('user-1');
  });

  it('does not delete document when clear request is sent but no document exists', async () => {
    const { useCase, userService } = buildUseCase({
      existsUserDocumentByUserId: jest.fn(async () => false),
    });

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        document: '',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.deleteUserDocumentById).not.toHaveBeenCalled();
  });

  it('throws when creating a missing document without document type', async () => {
    const { useCase } = buildUseCase({
      existsUserDocumentByUserId: jest.fn(async () => false),
    });

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        document: '12345678900',
      } as never)
    ).rejects.toThrow('user_document_type_id is required to create document');
  });

  it('throws when creating user document fails', async () => {
    const { useCase } = buildUseCase({
      existsUserDocumentByUserId: jest.fn(async () => false),
      createUserDocumentWithoutTransaction: jest.fn(async () => false),
    });
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', {
        document_type_id: 'cpf',
        document: '12345678900',
      } as never)
    ).rejects.toThrow('user_document_create_failed');
  });

  it('throws when updating existing user document fails', async () => {
    const { useCase } = buildUseCase({
      existsUserDocumentByUserId: jest.fn(async () => true),
      updateUserDocumentById: jest.fn(async () => false),
    });
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', {
        document_type_id: 'cpf',
        document: '12345678900',
      } as never)
    ).rejects.toThrow('user_document_update_failed');
  });

  it('creates and updates document successfully through execute', async () => {
    const { useCase, userService } = buildUseCase({
      existsUserDocumentByUserId: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      updateUserInfoById: jest.fn(async () => true),
    });

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        document_type_id: 'cpf',
        document: '12345678900',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(
      userService.createUserDocumentWithoutTransaction
    ).toHaveBeenCalledWith(
      {
        user_document_type_id: 'cpf',
        document: 'hash-12345678900',
        document_partial: 'partial-12345678900',
        document_c: 'enc-12345678900',
      },
      'user-1'
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        document_type_id: 'cpf',
        document: '98765432100',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.updateUserDocumentById).toHaveBeenCalledWith('user-1', {
      user_document_type_id: 'cpf',
      document: 'hash-98765432100',
      document_partial: 'partial-98765432100',
      document_c: 'enc-98765432100',
    });
  });

  it('covers helper branches for null phone and null document encryption', () => {
    const { useCase } = buildUseCase();

    expect((useCase as any).encryptPhoneData(null)).toEqual({
      phoneCEncrypted: null,
      phonePartialEncrypted: null,
      phoneC: null,
    });
    expect((useCase as any).encryptDocumentData(null)).toEqual({
      documentCEncrypted: null,
      documentPartialEncrypted: null,
      documentC: null,
    });
  });
});
