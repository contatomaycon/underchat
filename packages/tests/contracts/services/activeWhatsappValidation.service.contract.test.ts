import 'reflect-metadata';

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@core/services/twoFactor.service', () => ({
  TwoFactorService: class {},
}));
jest.mock('@core/services/accountTest.service', () => ({
  AccountTestService: class {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));
jest.mock('@core/repositories/auth/Auth.repository', () => ({
  AuthRepository: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, fn: () => Promise<unknown>) => fn()
  ),
}));
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(() => 'signed-token'),
  },
}));

import { ActiveWhatsappValidationService } from '@core/services/activeWhatsappValidation.service';
import { registerValidationCentrifugo } from '@core/common/functions/centrifugoQueue';
import { ITwoFactorData } from '@core/common/interfaces/ITwoFactorData';

const validationCode = 'ABCD-EF12-3456-WXYZ-UNDERCHAT';
const validationText = `Código de Validação: ${validationCode}`;

function createValidation(
  overrides: Partial<ITwoFactorData> = {}
): ITwoFactorData {
  return {
    two_factor_id: 'two-factor-1',
    user_id: null,
    phone_ddi: '55',
    phone: 'pwd:61995999040',
    phone_c: 'enc:61995999040',
    email: 'pwd:john@example.com',
    email_c: 'enc:john@example.com',
    code: validationCode,
    token: 'register-random-token',
    worker_id: 'worker-1',
    worker_number: '5561995999040',
    validation_context: 'register',
    validated_at: null,
    created_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

function createService() {
  const twoFactorService = {
    findActiveValidationByCode: jest.fn(),
    updateDeletedAt: jest.fn(async () => undefined),
    updateValidatedAt: jest.fn(async () => undefined),
  };
  const accountTestService = {
    checkExistingTestByPhone: jest.fn(async () => false),
    reserveValidatedTest: jest.fn(async () => undefined),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value.replace(/^pwd:/, '')),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
  };
  const authRepository = {
    findUserById: jest.fn(async () => ({
      user_id: 'user-1',
      account_id: 'account-1',
    })),
  };
  const accountService = {
    isAccountBlocked: jest.fn(async () => false),
  };

  const service = new ActiveWhatsappValidationService(
    twoFactorService as never,
    accountTestService as never,
    passwordEncryptorService as never,
    centrifugoService as never,
    authRepository as never,
    accountService as never,
    {} as never
  );

  return {
    service,
    mocks: {
      twoFactorService,
      accountTestService,
      passwordEncryptorService,
      centrifugoService,
      authRepository,
      accountService,
    },
  };
}

describe('ActiveWhatsappValidationService', () => {
  it('ignores messages outside the validation pattern', async () => {
    const { service, mocks } = createService();

    await expect(
      service.handleIncomingMessage({
        workerId: 'worker-1',
        fromPhone: '5561995999040',
        messageText: 'olá',
      })
    ).resolves.toBe(false);

    expect(
      mocks.twoFactorService.findActiveValidationByCode
    ).not.toHaveBeenCalled();
  });

  it.each([
    `Recebi o ${validationText}`,
    `${validationText} agora`,
    ` ${validationText}`,
    `${validationText} `,
    `Código de Validação:  ${validationCode}`,
    `Código de validacão: ${validationCode}`,
    `Código de Validação: ${validationCode.toLowerCase()}`,
  ])(
    'does not consume similar validation messages: %s',
    async (messageText) => {
      const { service, mocks } = createService();

      await expect(
        service.handleIncomingMessage({
          workerId: 'worker-1',
          fromPhone: '5561995999040',
          messageText,
        })
      ).resolves.toBe(false);

      expect(
        mocks.twoFactorService.findActiveValidationByCode
      ).not.toHaveBeenCalled();
      expect(mocks.centrifugoService.publishSub).not.toHaveBeenCalled();
    }
  );

  it('validates register message from the expected phone and channel', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation()
    );

    await expect(
      service.handleIncomingMessage({
        workerId: 'worker-1',
        fromPhone: '5561995999040',
        messageText: validationText,
      })
    ).resolves.toBe(true);

    expect(mocks.accountTestService.reserveValidatedTest).toHaveBeenCalledWith({
      validationId: 'two-factor-1',
      phone: '61995999040',
      email: 'john@example.com',
    });
    expect(mocks.twoFactorService.updateValidatedAt).toHaveBeenCalledWith(
      'two-factor-1',
      expect.any(String)
    );
    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'validated',
        context: 'register',
        token: 'signed-token',
      }
    );
  });

  it('rejects validation sent to a different channel', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation()
    );

    await service.handleIncomingMessage({
      workerId: 'worker-2',
      fromPhone: '5561995999040',
      messageText: validationText,
    });

    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'rejected',
        context: 'register',
        reason: 'worker_mismatch',
      }
    );
    expect(mocks.twoFactorService.updateValidatedAt).not.toHaveBeenCalled();
  });

  it('rejects validation sent by a different phone', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation()
    );

    await service.handleIncomingMessage({
      workerId: 'worker-1',
      fromPhone: '5561888888888',
      messageText: validationText,
    });

    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'rejected',
        context: 'register',
        reason: 'phone_mismatch',
      }
    );
    expect(
      mocks.accountTestService.reserveValidatedTest
    ).not.toHaveBeenCalled();
  });

  it('rejects expired validation code', async () => {
    const { service, mocks } = createService();
    const expired = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation({ created_at: expired })
    );

    await service.handleIncomingMessage({
      workerId: 'worker-1',
      fromPhone: '5561995999040',
      messageText: validationText,
    });

    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'rejected',
        context: 'register',
        reason: 'code_expired',
      }
    );
    expect(mocks.twoFactorService.updateDeletedAt).toHaveBeenCalledWith(
      'two-factor-1',
      expect.any(String)
    );
  });

  it('rejects second pending window when the phone is already reserved', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation()
    );
    mocks.accountTestService.checkExistingTestByPhone.mockResolvedValue(true);

    await service.handleIncomingMessage({
      workerId: 'worker-1',
      fromPhone: '5561995999040',
      messageText: validationText,
    });

    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'rejected',
        context: 'register',
        reason: 'phone_already_validated',
      }
    );
    expect(
      mocks.accountTestService.reserveValidatedTest
    ).not.toHaveBeenCalled();
    expect(mocks.twoFactorService.updateValidatedAt).not.toHaveBeenCalled();
  });

  it('publishes forgot password reset token after active validation', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCode.mockResolvedValue(
      createValidation({
        user_id: 'user-1',
        validation_context: 'forgot_password',
      })
    );

    await service.handleIncomingMessage({
      workerId: 'worker-1',
      fromPhone: '5561995999040',
      messageText: validationText,
    });

    expect(
      mocks.accountTestService.reserveValidatedTest
    ).not.toHaveBeenCalled();
    expect(mocks.authRepository.findUserById).toHaveBeenCalledWith('user-1');
    expect(mocks.centrifugoService.publishSub).toHaveBeenCalledWith(
      registerValidationCentrifugo('two-factor-1'),
      {
        status: 'validated',
        context: 'forgot_password',
        token: 'signed-token',
      }
    );
  });
});
