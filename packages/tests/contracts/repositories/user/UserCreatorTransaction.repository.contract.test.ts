import 'reflect-metadata';
import { UserTransactionCreatorRepository } from '@core/repositories/user/UserCreatorTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

type Dependencies = {
  dbRw: { transaction: jest.Mock };
  encryptService: { sanitize: jest.Mock; encrypt: jest.Mock };
  passwordEncryptorService: { encrypt: jest.Mock };
  userCreatorRepository: { createUser: jest.Mock };
  userAddressCreatorRepository: { createUserAddress: jest.Mock };
  userDocumentCreatorRepository: { createUserDocument: jest.Mock };
  userInfoCreatorRepository: { createUserInfo: jest.Mock };
  userExistsByEmailAndPhoneRepository: {
    existsUserByEmail: jest.Mock;
    existsUserByPhone: jest.Mock;
  };
  chatUserCreatorRepository: { createChatUser: jest.Mock };
  permissionAssignmentCreatorRepository: {
    createPermissionAssignmentInTransaction: jest.Mock;
  };
  sectorUserCreatorRepository: { createSectorUserInTransaction: jest.Mock };
  userChannelCreatorRepository: { createUserChannelInTransaction: jest.Mock };
};

function buildDependencies(overrides?: Partial<Dependencies>): Dependencies {
  const base: Dependencies = {
    dbRw: {
      transaction: jest.fn(async (callback) => callback({ tx: true })),
    },
    encryptService: {
      sanitize: jest.fn((value: string) => `san(${value})`),
      encrypt: jest.fn((value: string) => `enc(${value})`),
    },
    passwordEncryptorService: {
      encrypt: jest.fn((value: string) => `pwd(${value})`),
    },
    userCreatorRepository: {
      createUser: jest.fn(async () => 'user-1'),
    },
    userAddressCreatorRepository: {
      createUserAddress: jest.fn(async () => true),
    },
    userDocumentCreatorRepository: {
      createUserDocument: jest.fn(async () => true),
    },
    userInfoCreatorRepository: {
      createUserInfo: jest.fn(async () => true),
    },
    userExistsByEmailAndPhoneRepository: {
      existsUserByEmail: jest.fn(async () => false),
      existsUserByPhone: jest.fn(async () => false),
    },
    chatUserCreatorRepository: {
      createChatUser: jest.fn(async () => true),
    },
    permissionAssignmentCreatorRepository: {
      createPermissionAssignmentInTransaction: jest.fn(async () => 'pa-1'),
    },
    sectorUserCreatorRepository: {
      createSectorUserInTransaction: jest.fn(async () => 'su-1'),
    },
    userChannelCreatorRepository: {
      createUserChannelInTransaction: jest.fn(async () => 'uc-1'),
    },
  };

  return { ...base, ...(overrides ?? {}) };
}

function buildRepository(deps: Dependencies) {
  return new UserTransactionCreatorRepository(
    deps.dbRw as never,
    deps.encryptService as never,
    deps.passwordEncryptorService as never,
    deps.userCreatorRepository as never,
    deps.userAddressCreatorRepository as never,
    deps.userDocumentCreatorRepository as never,
    deps.userInfoCreatorRepository as never,
    deps.userExistsByEmailAndPhoneRepository as never,
    deps.chatUserCreatorRepository as never,
    deps.permissionAssignmentCreatorRepository as never,
    deps.sectorUserCreatorRepository as never,
    deps.userChannelCreatorRepository as never
  );
}

const t = ((key: string) => key) as never;

describe('UserTransactionCreatorRepository', () => {
  it('validateBirthDate throws for invalid date format', () => {
    const repository = buildRepository(buildDependencies());

    expect(() =>
      (repository as any).validateBirthDate(t, '10/10/1990')
    ).toThrow('date_must_be_in_the_format_yyyy_mm_dd');
  });

  it('throws when email or password is missing', async () => {
    const repository = buildRepository(buildDependencies());

    await expect(
      repository.createUser(t, 'account-1', {
        name: { value: 'John' },
        last_name: { value: 'Doe' },
      } as never)
    ).rejects.toThrow('email_required');
  });

  it('throws when email already exists', async () => {
    const dependencies = buildDependencies({
      userExistsByEmailAndPhoneRepository: {
        existsUserByEmail: jest.fn(async () => true),
        existsUserByPhone: jest.fn(async () => false),
      },
    });
    const repository = buildRepository(dependencies);

    await expect(
      repository.createUser(t, 'account-1', {
        email: { value: 'john@example.com' },
        password: { value: 'secret' },
        name: { value: 'John' },
        last_name: { value: 'Doe' },
      } as never)
    ).rejects.toThrow('user_already_exists_email');
  });

  it('throws when createUser repository returns null', async () => {
    const dependencies = buildDependencies({
      userCreatorRepository: {
        createUser: jest.fn(async () => null),
      },
    });
    const repository = buildRepository(dependencies);

    await expect(
      repository.createUser(t, 'account-1', {
        email: { value: 'john@example.com' },
        password: { value: 'secret' },
        name: { value: 'John' },
        last_name: { value: 'Doe' },
      } as never)
    ).rejects.toThrow('user_creation_failed');
  });

  it('creates user and related entities in happy path', async () => {
    const dependencies = buildDependencies();
    const repository = buildRepository(dependencies);

    await expect(
      repository.createUser(
        t,
        'account-1',
        {
          email: { value: 'John@Example.com ' },
          password: { value: 'secret' },
          phone_ddi: { value: '55' },
          phone: { value: '11999999999' },
          name: { value: 'John' },
          last_name: { value: 'Doe' },
          birth_date: { value: '1990-01-01' },
          document_type_id: { value: 'doc-type-1' },
          document: { value: '12345678900' },
          country_id: { value: 55 },
          address1: { value: 'Street 1' },
          address2: { value: 'Apt 2' },
          zip_code: { value: '01001-000' },
          city_fiscal_code: { value: '3550308' },
          state_fiscal_code: { value: '35' },
          district: { value: 'Centro' },
          permission_role_id: { value: 'role-1' },
          sector_ids: ['sector-1'],
          channel_ids: ['channel-1'],
        } as never,
        'photo-url'
      )
    ).resolves.toBe(true);

    expect(dependencies.userCreatorRepository.createUser).toHaveBeenCalledTimes(
      1
    );
    expect(
      dependencies.permissionAssignmentCreatorRepository
        .createPermissionAssignmentInTransaction
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.sectorUserCreatorRepository.createSectorUserInTransaction
    ).toHaveBeenCalledTimes(1);
    expect(
      dependencies.userChannelCreatorRepository.createUserChannelInTransaction
    ).toHaveBeenCalledTimes(1);
  });

  it('throws when permission assignment creation fails', async () => {
    const dependencies = buildDependencies({
      permissionAssignmentCreatorRepository: {
        createPermissionAssignmentInTransaction: jest.fn(async () => null),
      },
    });
    const repository = buildRepository(dependencies);

    await expect(
      repository.createUser(t, 'account-1', {
        email: { value: 'john@example.com' },
        password: { value: 'secret' },
        name: { value: 'John' },
        last_name: { value: 'Doe' },
        permission_role_id: { value: 'role-1' },
      } as never)
    ).rejects.toThrow('user_role_assignment_failed');
  });
});
