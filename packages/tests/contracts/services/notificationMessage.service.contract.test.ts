import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('@core/services/user.service', () => ({ UserService: class {} }));
jest.mock('uuid', () => ({ v7: () => 'uuid-v7-mock' }));
jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, action: () => Promise<unknown>) =>
      action()
  ),
}));
import { NotificationMessageService } from '@core/services/notificationMessage.service';
import {
  ENotificationType,
  ENotificationTypeId,
} from '@core/common/enums/ENotificationType';
import { INotificationMessage } from '@core/common/interfaces/INotificationMessage';

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
  const workerCommandAdmissionService = {
    admit: jest.fn(async () => undefined),
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
  const messageSendIdempotencyService = {
    claimOperation: jest.fn<Promise<unknown>, unknown[]>(async () => ({
      status: 'acquired',
      state: 'reserved',
      accountId: 'account-1',
      operationType: 'notification_email',
      operationId: 'operation-1',
      key: 'message-send:idempotency:v3:account-1:email',
      owner: 'owner-1',
      result: null,
    })),
    markProviderInvoked: jest.fn(async () => 'transitioned'),
    markSucceeded: jest.fn(async () => 'transitioned'),
    markAmbiguous: jest.fn(async () => 'transitioned'),
    releaseReservation: jest.fn(async () => 'transitioned'),
  };

  const service = new NotificationMessageService(
    notificationMessageViewerRepository as never,
    userMasterViewerRepository as never,
    elasticDatabaseService as never,
    streamProducerService as never,
    workerCommandAdmissionService as never,
    userService as never,
    userInfoViewerRepository as never,
    workerNameViewerRepository as never,
    planCurrentInvoiceViewerRepository as never,
    emailService as never,
    kafkaServiceQueueService as never,
    twoFactorCreatorRepository as never,
    passwordEncryptorService as never,
    encryptService as never,
    {} as never,
    messageSendIdempotencyService as never
  );

  return {
    service,
    mocks: {
      notificationMessageViewerRepository,
      userMasterViewerRepository,
      elasticDatabaseService,
      streamProducerService,
      workerCommandAdmissionService,
      userService,
      userInfoViewerRepository,
      workerNameViewerRepository,
      planCurrentInvoiceViewerRepository,
      emailService,
      twoFactorCreatorRepository,
      messageSendIdempotencyService,
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
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).resolves.toBe(true);

    expect(mocks.workerCommandAdmissionService.admit).toHaveBeenCalledTimes(1);
    expect(mocks.workerCommandAdmissionService.admit).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'notification_send',
      entityKey: 'chat:account-1:worker-1:5511991204099@s.whatsapp.net',
      operationId: 'operation-1',
      payload: expect.objectContaining({ notification_id: 'notification-1' }),
      source: 'notification',
    });
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
    expect(mocks.elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^notification_message_v2_[a-f0-9]{64}$/),
      expect.objectContaining({
        message_whatsapp: 'Olá John, plano Pro',
        message_email: null,
        email_subject: null,
      }),
      { upsert: true }
    );
  });

  it('preserves the notification operation id in the worker command', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ email_enabled: false })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
    );

    expect(mocks.workerCommandAdmissionService.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'notification_send',
        entityKey: 'chat:account-1:worker-1:5511991204099@s.whatsapp.net',
        operationId: 'operation-1',
        payload: expect.objectContaining({
          notification_id: 'notification-1',
          operation_id: 'operation-1',
        }),
      })
    );
  });

  it('uses a stable physical Elasticsearch id per account and operation', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ email_enabled: false })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
    );
    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
    );
    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-2'
    );
    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-2',
      () => undefined,
      'operation-1'
    );

    const calls = mocks.elasticDatabaseService.updateWithOCC.mock
      .calls as unknown as Array<[string, string, INotificationMessage]>;
    expect(calls).toHaveLength(4);
    expect(calls[0]?.[1]).toMatch(/^notification_message_v2_[a-f0-9]{64}$/);
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(calls[0]?.[1]).not.toBe(calls[2]?.[1]);
    expect(calls[0]?.[1]).not.toBe(calls[3]?.[1]);
    expect(calls[0]?.[2]).toEqual(
      expect.objectContaining({
        id: calls[0]?.[1],
        operation_id: 'operation-1',
      })
    );
  });

  it('uses the legacy notification id only when operation id is absent', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ email_enabled: false })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1'
    );

    expect(mocks.elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      expect.any(String),
      'notification-1',
      expect.not.objectContaining({ operation_id: expect.anything() }),
      { upsert: true }
    );
  });

  it('creates a distinct operation id for every original notification command', async () => {
    const { service, mocks } = createService();

    await service.sendPlanNotification(
      'account-1',
      'plan-1',
      ENotificationTypeId.plan_new
    );
    await service.sendPlanNotification(
      'account-1',
      'plan-1',
      ENotificationTypeId.plan_new
    );

    const calls = mocks.streamProducerService.send.mock
      .calls as unknown as Array<[string, { operation_id: string }, string]>;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe('notification-message-topic');
    expect(calls[0]?.[2]).toBe(`account-1:${ENotificationTypeId.plan_new}`);
    expect(calls[0]?.[1].operation_id).toEqual(expect.any(String));
    expect(calls[1]?.[1].operation_id).toEqual(expect.any(String));
    expect(calls[0]?.[1].operation_id).not.toBe(calls[1]?.[1].operation_id);
  });

  it('propagates a failure while publishing the plan notification command', async () => {
    const { service, mocks } = createService();
    const producerError = new Error('Kafka unavailable');
    mocks.streamProducerService.send.mockRejectedValueOnce(producerError);

    await expect(
      service.sendPlanNotification(
        'account-1',
        'plan-1',
        ENotificationTypeId.plan_new
      )
    ).rejects.toBe(producerError);
  });

  it('sends only email when email is enabled and WhatsApp is disabled', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
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
      expect.stringMatching(/^notification_message_v2_[a-f0-9]{64}$/),
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
      'account-1',
      () => undefined,
      'operation-1'
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
      'account-1',
      () => undefined,
      'operation-1'
    );

    expect(
      mocks.workerNameViewerRepository.findWorkerNameById
    ).not.toHaveBeenCalled();
    expect(mocks.streamProducerService.send).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('sends the same notification email operation at most once across retries', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.messageSendIdempotencyService.claimOperation
      .mockResolvedValueOnce({
        status: 'acquired',
        state: 'reserved',
        accountId: 'account-1',
        operationType: 'notification_email',
        operationId: 'operation-1',
        key: 'message-send:idempotency:v3:account-1:email',
        owner: 'owner-1',
        result: null,
      })
      .mockResolvedValueOnce({
        status: 'duplicate',
        state: 'succeeded',
        accountId: 'account-1',
        operationType: 'notification_email',
        operationId: 'operation-1',
        key: 'message-send:idempotency:v3:account-1:email',
        owner: null,
        result: null,
      });

    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
    );
    await service.sendNotificationMessage(
      ENotificationTypeId.plan_new,
      'account-1',
      () => undefined,
      'operation-1'
    );

    expect(
      mocks.messageSendIdempotencyService.claimOperation
    ).toHaveBeenCalledTimes(2);
    expect(mocks.emailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('marks an email provider failure ambiguous and propagates it', async () => {
    const { service, mocks } = createService();
    const providerError = new Error('email provider timeout');
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.emailService.sendEmail.mockRejectedValueOnce(providerError);

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).rejects.toBe(providerError);

    expect(
      mocks.messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.messageSendIdempotencyService.markAmbiguous
    ).toHaveBeenCalledWith(expect.any(Object), providerError);
    expect(
      mocks.messageSendIdempotencyService.markSucceeded
    ).not.toHaveBeenCalled();
  });

  it('revalidates the assignment after fencing and does not call email when revoked', async () => {
    const { service, mocks } = createService();
    const revokedError = new Error('assignment revoked');
    let revoked = false;
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.messageSendIdempotencyService.markProviderInvoked.mockImplementationOnce(
      async () => {
        revoked = true;
        return 'transitioned';
      }
    );

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => {
          if (revoked) {
            throw revokedError;
          }
        },
        'operation-1'
      )
    ).rejects.toBe(revokedError);

    expect(
      mocks.messageSendIdempotencyService.markProviderInvoked
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.messageSendIdempotencyService.markAmbiguous
    ).toHaveBeenCalledWith(expect.any(Object), revokedError);
    expect(
      mocks.messageSendIdempotencyService.releaseReservation
    ).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('safely releases only a reservation when the provider-boundary response is lost', async () => {
    const { service, mocks } = createService();
    const responseLostError = new Error('Redis response lost');
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.messageSendIdempotencyService.markProviderInvoked.mockRejectedValueOnce(
      responseLostError
    );
    mocks.messageSendIdempotencyService.releaseReservation.mockResolvedValueOnce(
      'invalid_state'
    );

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).rejects.toBe(responseLostError);

    expect(
      mocks.messageSendIdempotencyService.releaseReservation
    ).toHaveBeenCalledWith(expect.any(Object));
    expect(
      mocks.messageSendIdempotencyService.markAmbiguous
    ).not.toHaveBeenCalled();
    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('preserves the original boundary error when reservation release also fails', async () => {
    const { service, mocks } = createService();
    const responseLostError = new Error('Redis response lost');
    const releaseError = new Error('Redis unavailable during release');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.messageSendIdempotencyService.markProviderInvoked.mockRejectedValueOnce(
      responseLostError
    );
    mocks.messageSendIdempotencyService.releaseReservation.mockRejectedValueOnce(
      releaseError
    );

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).rejects.toBe(responseLostError);

    expect(consoleError).toHaveBeenCalledWith(
      'Unable to release notification email reservation:',
      releaseError
    );
    consoleError.mockRestore();
  });

  it('preserves the provider error when marking ambiguity also fails', async () => {
    const { service, mocks } = createService();
    const providerError = new Error('email provider timeout');
    const ledgerError = new Error('Redis unavailable during ambiguity mark');
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.emailService.sendEmail.mockRejectedValueOnce(providerError);
    mocks.messageSendIdempotencyService.markAmbiguous.mockRejectedValueOnce(
      ledgerError
    );

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).rejects.toBe(providerError);

    expect(consoleError).toHaveBeenCalledWith(
      'Unable to mark notification email delivery ambiguous:',
      ledgerError
    );
    consoleError.mockRestore();
  });

  it('fails closed before email when the shared ledger is unavailable', async () => {
    const { service, mocks } = createService();
    mocks.notificationMessageViewerRepository.findNotificationByTypeId.mockResolvedValue(
      buildNotification({ whatsapp_enabled: false })
    );
    mocks.messageSendIdempotencyService.claimOperation.mockResolvedValueOnce({
      status: 'error',
      state: null,
      accountId: 'account-1',
      operationType: 'notification_email',
      operationId: 'operation-1',
      key: null,
      owner: null,
      result: null,
    });

    await expect(
      service.sendNotificationMessage(
        ENotificationTypeId.plan_new,
        'account-1',
        () => undefined,
        'operation-1'
      )
    ).rejects.toThrow('Unable to reserve notification email delivery');

    expect(mocks.emailService.sendEmail).not.toHaveBeenCalled();
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
