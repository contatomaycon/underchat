import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@core/services/user.service', () => ({ UserService: class {} }));
jest.mock('uuid', () => ({ v7: () => 'uuid-v7-mock' }));
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import {
  ENotificationType,
  ENotificationTypeId,
} from '@core/common/enums/ENotificationType';

function createService() {
  const notificationMessageViewerRepository = {
    findNotificationByTypeId: jest.fn(),
  };
  const userMasterViewerRepository = {
    findMasterUserByAccountId: jest.fn(async () => ({
      user_id: 'user-1',
      account_name: 'Account',
    })),
  };
  const elasticDatabaseService = {
    indices: jest.fn(async () => undefined),
    updateWithOCC: jest.fn(async () => undefined),
  };
  const streamProducerService = {
    send: jest.fn(async () => undefined),
  };
  const kafkaBaileysQueueService = {
    workerNotificationMessage: jest.fn((workerId: string) => {
      return `worker-topic-${workerId}`;
    }),
  };
  const userService = {
    getUserPhoneDecrypted: jest.fn(() => '11991204099'),
    getUserPhoneJidDecrypted: jest.fn(() => '5511991204099@s.whatsapp.net'),
    getUserSensitiveDataDecrypted: jest.fn(async () => ({
      email: 'john@example.com',
    })),
  };
  const userInfoViewerRepository = {
    findUserInfoByUserId: jest.fn(async () => ({
      name: 'John',
      last_name: 'Doe',
      phone: 'encrypted-phone',
      phone_jid: 'encrypted-jid',
      phone_ddi: '55',
    })),
  };
  const workerNameViewerRepository = {
    findWorkerNameById: jest.fn(async () => 'Conta Business'),
  };
  const planCurrentInvoiceViewerRepository = {
    viewCurrentPlanInvoice: jest.fn(async () => ({
      plan_name: 'Pro',
      next_payment_date: '2026-06-01T00:00:00.000Z',
      current_total_cycle_value: null,
      plan_account_value: null,
      plan_price: '99.90',
      last_paid_invoice_value: null,
    })),
  };
  const emailService = {
    sendEmail: jest.fn(async () => undefined),
  };
  const kafkaServiceQueueService = {
    notificationMessage: jest.fn(() => 'notification-message-topic'),
  };
  const twoFactorCreatorRepository = {
    createTwoFactor: jest.fn(async () => 'two-factor-1'),
  };
  const passwordEncryptorService = {
    encrypt: jest.fn((value: string) => `pwd:${value}`),
  };
  const encryptService = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
    sanitize: jest.fn((value: string) => value),
  };

  const service = new NotificationMessageService(
    notificationMessageViewerRepository as never,
    userMasterViewerRepository as never,
    elasticDatabaseService as never,
    streamProducerService as never,
    kafkaBaileysQueueService as never,
    userService as never,
    userInfoViewerRepository as never,
    workerNameViewerRepository as never,
    planCurrentInvoiceViewerRepository as never,
    emailService as never,
    kafkaServiceQueueService as never,
    twoFactorCreatorRepository as never,
    passwordEncryptorService as never,
    encryptService as never,
    {} as never
  );

  return {
    service,
    mocks: {
      notificationMessageViewerRepository,
      userMasterViewerRepository,
      elasticDatabaseService,
      streamProducerService,
      kafkaBaileysQueueService,
      userService,
      userInfoViewerRepository,
      workerNameViewerRepository,
      planCurrentInvoiceViewerRepository,
      emailService,
      twoFactorCreatorRepository,
    },
  };
}

function buildNotification(overrides: Record<string, unknown> = {}) {
  return {
    notification_id: 'notification-1',
    notification_type_id: ENotificationTypeId.plan_new,
    worker_id: 'worker-1',
    whatsapp_enabled: true,
    email_enabled: true,
    message_whatsapp: 'Olá {{name}}, plano {{plan}}',
    message_email: '<p>Olá {{name}}, plano {{plan}}</p>',
    email_subject: 'Plano {{plan}}',
    nnt: {
      notification_type_id: ENotificationTypeId.plan_new,
      name: ENotificationType.plan_new,
    },
    nwr: {
      worker_id: 'worker-1',
      name: 'Conta Business',
      number: '5561995999040',
    },
    ...overrides,
  };
}

function getFirstCall<TArgs extends unknown[]>(
  calls: TArgs[],
  methodName: string
): TArgs {
  const call = calls.at(0);

  if (!call) {
    throw new Error(`${methodName} was not called`);
  }

  return call;
}

describe('NotificationMessageService', () => {
  it('sends only WhatsApp when WhatsApp is enabled and email is disabled', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ email_enabled: false })
    );

    await expect(
      service.sendNotificationMessage(ENotificationTypeId.plan_new, 'account-1')
    ).resolves.toBe(true);

    expect(mocks.streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
    expect(mocks.elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      expect.any(String),
      'notification-1',
      expect.objectContaining({
        message_whatsapp: 'Olá John, plano Pro',
        message_email: null,
        email_subject: null,
      }),
      { upsert: true }
    );
  });

  it('sends only email when email is enabled and WhatsApp is disabled', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1'
    );

    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).toHaveBeenCalledWith({
      to: 'john@example.com',
      subject: 'Plano Pro',
      html: '<p>Olá John, plano Pro</p>',
      text: '<p>Olá John, plano Pro</p>',
    });
    expect(mocks.elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      expect.any(String),
      'notification-1',
      expect.objectContaining({
        message_whatsapp: null,
        message_email: '<p>Olá John, plano Pro</p>',
        email_subject: 'Plano Pro',
      }),
      { upsert: true }
    );
  });

  it('does not send or save when both channels are disabled', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({
        whatsapp_enabled: false,
        email_enabled: false,
      })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1'
    );

    expect(
      mocks.userMasterViewerRepository.findMasterUserByAccountId
    ).not.toHaveBeenCalled();
    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
    expect(mocks.elasticDatabaseService.updateWithOCC).not.toHaveBeenCalled();
  });

  it('allows email-only notification with null worker', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({
        worker_id: null,
        whatsapp_enabled: true,
        email_enabled: true,
      })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1'
    );

    expect(
      mocks.workerNameViewerRepository.findWorkerNameById
    ).not.toHaveBeenCalled();
    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('generates active WhatsApp validation payload for two-factor without configurable message', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({
        notification_type_id: ENotificationTypeId.two_factor,
        whatsapp_enabled: true,
        email_enabled: false,
        message_whatsapp: null,
        message_email: null,
        email_subject: null,
        nnt: {
          notification_type_id: ENotificationTypeId.two_factor,
          name: ENotificationType.two_factor,
        },
      })
    );

    const result = await service.sendTwoFactorCodeWithChannels({
      email: 'john@example.com',
      userId: 'user-1',
      phone: '11991204099',
      phoneDdi: '55',
      name: 'John',
    });

    const createTwoFactorCalls = mocks.twoFactorCreatorRepository
      .createTwoFactor.mock.calls as unknown as Array<[Record<string, string>]>;
    const [createTwoFactorPayload] = getFirstCall(
      createTwoFactorCalls,
      'createTwoFactor'
    );
    const createdCode = createTwoFactorPayload.code;

    expect(createdCode).toMatch(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}-UNDERCHAT$/);
    expect(result).toEqual(
      expect.objectContaining({
        code: createdCode,
        sent_via_email: false,
        sent_via_whatsapp: true,
        validation_id: 'two-factor-1',
        validation_text: `Código de Validação: ${createdCode}`,
        target_phone: '5561995999040',
        centrifugo_channel: 'register.validation:session#two-factor-1',
      })
    );
    expect(result.whatsapp_url).toContain('phone=5561995999040');
    expect(new URL(result.whatsapp_url).searchParams.get('text')).toBe(
      `Código de Validação: ${createdCode}`
    );
    expect(
      mocks.twoFactorCreatorRepository.createTwoFactor
    ).toHaveBeenCalledTimes(1);
    expect(createTwoFactorPayload).toEqual(
      expect.objectContaining({
        workerId: 'worker-1',
        workerNumber: '5561995999040',
        validationContext: 'register',
      })
    );
    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects two-factor generation when WhatsApp channel is disabled', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({
        notification_type_id: ENotificationTypeId.two_factor,
        whatsapp_enabled: false,
        email_enabled: true,
        message_whatsapp: 'Código WhatsApp {{code}}',
        message_email: '<p>Código Email {{code}}</p>',
        nnt: {
          notification_type_id: ENotificationTypeId.two_factor,
          name: ENotificationType.two_factor,
        },
      })
    );

    await expect(
      service.sendTwoFactorCodeWithChannels({
        email: 'john@example.com',
        userId: 'user-1',
        phone: '11991204099',
        phoneDdi: '55',
        name: 'John',
      })
    ).rejects.toThrow('Two factor notification channels not configured');
    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
  });
});
