import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/notificationMessage.service', () => ({
  NotificationMessageService: class {},
}));
jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));

import { AuthRegisterSendTwoFactorUseCase } from '@core/useCases/auth/AuthRegisterSendTwoFactor.useCase';

describe('AuthRegisterSendTwoFactorUseCase', () => {
  const t = jest.fn((key: string) => key);

  const buildInput = () => ({
    name: 'Maycon',
    email: ' USER@EXAMPLE.COM ',
    phone_ddi: '+55',
    phone_ddd: '61',
    phone: '9599-9040',
  });

  const buildDeps = (overrides: Record<string, unknown> = {}) => {
    const userService = {
      existsUserByEmail: jest.fn(async () => false),
      existsUserByPhone: jest.fn(async () => false),
      ...((overrides.userService as object) ?? {}),
    };
    const notificationMessageService = {
      sendTwoFactorCodeWithChannels: jest.fn(async () => ({
        validation_id: 'two-factor-1',
        validation_text: 'Código de Validação: ABCD-EF12-3456-WXYZ-UNDERCHAT',
        whatsapp_url: 'https://web.whatsapp.com/send',
        target_phone: '+55 (61) 9203-7138',
        centrifugo_url: 'ws://localhost',
        centrifugo_token: 'centrifugo-token',
        centrifugo_channel: 'register:two-factor-1',
      })),
      ...((overrides.notificationMessageService as object) ?? {}),
    };
    const encryptService = {
      encrypt: jest.fn((value: string) => `enc:${value}`),
      ...((overrides.encryptService as object) ?? {}),
    };

    const useCase = new AuthRegisterSendTwoFactorUseCase(
      userService as never,
      notificationMessageService as never,
      encryptService as never
    );

    return {
      useCase,
      userService,
      notificationMessageService,
      encryptService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends register 2FA without checking account_test before finalization', async () => {
    const { useCase, userService, notificationMessageService, encryptService } =
      buildDeps();

    await expect(
      useCase.execute(t as never, buildInput())
    ).resolves.toMatchObject({
      success: true,
      message: 'register_code_sent',
      validation_id: 'two-factor-1',
    });

    expect(encryptService.encrypt).toHaveBeenCalledWith('user@example.com');
    expect(userService.existsUserByEmail).toHaveBeenCalledWith(
      'enc:user@example.com'
    );
    expect(userService.existsUserByPhone).toHaveBeenCalledWith(
      'enc:6195999040'
    );
    expect(userService.existsUserByPhone).toHaveBeenCalledWith(
      'enc:61995999040'
    );
    expect(
      notificationMessageService.sendTwoFactorCodeWithChannels
    ).toHaveBeenCalledWith({
      email: 'user@example.com',
      userId: null,
      phone: '6195999040',
      phoneDdi: '55',
      name: 'Maycon',
      context: 'register',
    });
  });

  it('keeps blocking when a user already exists with the email', async () => {
    const { useCase, userService, notificationMessageService } = buildDeps({
      userService: {
        existsUserByEmail: jest.fn(async () => true),
        existsUserByPhone: jest.fn(async () => false),
      },
    });

    await expect(useCase.execute(t as never, buildInput())).rejects.toThrow(
      'register_email_already_used'
    );

    expect(userService.existsUserByPhone).not.toHaveBeenCalled();
    expect(
      notificationMessageService.sendTwoFactorCodeWithChannels
    ).not.toHaveBeenCalled();
  });

  it('keeps blocking when a user already exists with either phone candidate', async () => {
    const { useCase, userService, notificationMessageService } = buildDeps({
      userService: {
        existsUserByEmail: jest.fn(async () => false),
        existsUserByPhone: jest.fn(async (phoneC: string) => {
          return phoneC === 'enc:61995999040';
        }),
      },
    });

    await expect(useCase.execute(t as never, buildInput())).rejects.toThrow(
      'register_phone_already_used'
    );

    expect(userService.existsUserByPhone).toHaveBeenCalledWith(
      'enc:6195999040'
    );
    expect(userService.existsUserByPhone).toHaveBeenCalledWith(
      'enc:61995999040'
    );
    expect(
      notificationMessageService.sendTwoFactorCodeWithChannels
    ).not.toHaveBeenCalled();
  });
});
