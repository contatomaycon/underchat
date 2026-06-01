import 'reflect-metadata';

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@core/services/twoFactor.service', () => ({
  TwoFactorService: class {},
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
    findActiveValidationByCodeAndWorkerId: jest.fn(),
    updateDeletedAt: jest.fn(async () => undefined),
    updateValidatedAt: jest.fn(async () => undefined),
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
    passwordEncryptorService as never,
    centrifugoService as never,
    authRepository as never,
    accountService as never
  );

  return {
    service,
    mocks: {
      twoFactorService,
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
      mocks.twoFactorService.findActiveValidationByCodeAndWorkerId
    ).not.toHaveBeenCalled();
  });

  it.each([
    validationCode.replace('UNDERCHAT', 'NDERCHAT'),
    `Código de Validação: ${validationCode.replace('UNDERCHAT', 'NDERCHAT')}`,
    `Código de Validação: ${validationCode.toLowerCase()}`,
  ])(
    'does not consume messages without a valid uppercase validation code: %s',
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
        mocks.twoFactorService.findActiveValidationByCodeAndWorkerId
      ).not.toHaveBeenCalled();
      expect(mocks.centrifugoService.publishSub).not.toHaveBeenCalled();
    }
  );

  it.each([
    validationText,
    validationCode,
    `Olá, segue código "${validationText}"`,
    `texto qualquer ${validationCode}`,
    `Código de Validação:  ${validationCode}`,
    `Código de validacão: ${validationCode}`,
  ])(
    'validates register message from the expected phone and channel: %s',
    async (messageText) => {
      const { service, mocks } = createService();
      mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
        createValidation()
      );

      await expect(
        service.handleIncomingMessage({
          workerId: 'worker-1',
          fromPhone: '5561995999040',
          messageText,
        })
      ).resolves.toBe(true);

      expect(
        mocks.twoFactorService.findActiveValidationByCodeAndWorkerId
      ).toHaveBeenCalledWith(validationCode, 'worker-1');
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
    }
  );

  it.each([
    {
      expectedPhone: '6195999040',
      fromPhone: '5561995999040',
      label: 'generated without 9 and received with 9',
    },
    {
      expectedPhone: '61995999040',
      fromPhone: '556195999040',
      label: 'generated with 9 and received without 9',
    },
  ])(
    'validates Brazilian phone variants with and without the ninth digit: $label',
    async ({ expectedPhone, fromPhone }) => {
      const { service, mocks } = createService();
      mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
        createValidation({
          phone: `pwd:${expectedPhone}`,
          phone_c: `enc:${expectedPhone}`,
        })
      );

      await expect(
        service.handleIncomingMessage({
          workerId: 'worker-1',
          fromPhone,
          messageText: validationText,
        })
      ).resolves.toBe(true);

      expect(mocks.twoFactorService.updateValidatedAt).toHaveBeenCalledWith(
        'two-factor-1',
        expect.any(String)
      );
    }
  );

  it.each([
    {
      fromPhone: '556295999040',
      label: 'different Brazilian DDD',
    },
    {
      fromPhone: '16195999040',
      label: 'different DDI',
    },
  ])(
    'rejects phone variants when the origin has a $label',
    async ({ fromPhone }) => {
      const { service, mocks } = createService();
      mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
        createValidation({
          phone: 'pwd:6195999040',
          phone_c: 'enc:6195999040',
        })
      );

      await service.handleIncomingMessage({
        workerId: 'worker-1',
        fromPhone,
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
      expect(mocks.twoFactorService.updateValidatedAt).not.toHaveBeenCalled();
    }
  );

  it('lets validation-like messages from a different channel continue as normal messages', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
      null
    );

    await expect(
      service.handleIncomingMessage({
        workerId: 'worker-2',
        fromPhone: '5561995999040',
        messageText: validationText,
      })
    ).resolves.toBe(false);

    expect(
      mocks.twoFactorService.findActiveValidationByCodeAndWorkerId
    ).toHaveBeenCalledWith(validationCode, 'worker-2');
    expect(mocks.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(mocks.twoFactorService.updateValidatedAt).not.toHaveBeenCalled();
    expect(mocks.twoFactorService.updateDeletedAt).not.toHaveBeenCalled();
  });

  it('continues normal processing when no active validation exists for the code and channel', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
      null
    );

    await expect(
      service.handleIncomingMessage({
        workerId: 'worker-1',
        fromPhone: '5561995999040',
        messageText: validationText,
      })
    ).resolves.toBe(false);

    expect(mocks.centrifugoService.publishSub).not.toHaveBeenCalled();
    expect(mocks.twoFactorService.updateValidatedAt).not.toHaveBeenCalled();
    expect(mocks.twoFactorService.updateDeletedAt).not.toHaveBeenCalled();
  });

  it('rejects validation sent by a different phone', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
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
  });

  it('rejects expired validation code', async () => {
    const { service, mocks } = createService();
    const expired = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
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

  it('publishes forgot password reset token after active validation', async () => {
    const { service, mocks } = createService();
    mocks.twoFactorService.findActiveValidationByCodeAndWorkerId.mockResolvedValue(
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
