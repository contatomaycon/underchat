import 'reflect-metadata';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WhatsappOfficialWebhookSubscriptionEnsurerUseCase } from '@core/useCases/worker/WhatsappOfficialWebhookSubscriptionEnsurer.useCase';

const t = ((key: string) => key) as never;

const connection = {
  worker_whatsapp_official_connection_id: 'connection-1',
  worker_id: 'worker-1',
  business_id: 'business-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
  access_token_encrypted: 'enc:old-token',
  api_version: 'v24.0',
};

const authorization = {
  code: 'authorization-code-1',
  business_id: 'business-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
};

function buildUseCase(overrides: Record<string, unknown> = {}) {
  const workerService = {
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Official Channel',
      type: { id: EWorkerType.whatsapp },
    })),
  };
  const metaWhatsappEmbeddedService = {
    exchangeCode: jest.fn(async () => ({
      access_token: 'new-token-1',
      token_type: 'bearer',
      expires_at: null,
      scope:
        'business_management,whatsapp_business_management,whatsapp_business_messaging',
    })),
    debugAccessToken: jest.fn(async () => ({
      app_id: 'app-1',
      type: 'SYSTEM_USER',
      is_valid: true,
      issued_at: 1_785_789_163,
      expires_at: 0,
      data_access_expires_at: 0,
      scopes: [
        'business_management',
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ],
      granular_scopes: [],
    })),
    viewPhoneNumber: jest.fn(async () => ({
      id: 'phone-1',
      display_phone_number: '+55 16 99999-9999',
      verified_name: 'Underchat',
    })),
    subscribeWabaApp: jest.fn(async () => true),
  };
  const whatsappEmbeddedService = {
    viewInternalConfig: jest.fn(async () => ({
      app_id: 'app-1',
      app_secret: 'app-secret-1',
      webhook_verify_token: 'verify-token-1',
      configuration_id: 'configuration-1',
      api_version: 'v25.0',
    })),
  };
  const passwordEncryptorService = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };
  const officialConnectionRepository = {
    findActiveByWorkerId: jest.fn(async () => connection),
    updateActiveAuthorization: jest.fn(async () => true),
    reconcileActiveWorkerStatus: jest.fn(async () => true),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
  };

  const baseDeps = {
    workerService,
    metaWhatsappEmbeddedService,
    whatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    centrifugoService,
  };
  const deps = {
    ...baseDeps,
    ...overrides,
    metaWhatsappEmbeddedService: {
      ...metaWhatsappEmbeddedService,
      ...((overrides.metaWhatsappEmbeddedService as object | undefined) ?? {}),
    },
    officialConnectionRepository: {
      ...officialConnectionRepository,
      ...((overrides.officialConnectionRepository as object | undefined) ?? {}),
    },
  };

  const useCase = new WhatsappOfficialWebhookSubscriptionEnsurerUseCase(
    deps.workerService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.whatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never,
    deps.centrifugoService as never
  );

  return { useCase, deps };
}

describe('WhatsappOfficialWebhookSubscriptionEnsurerUseCase', () => {
  it('reauthorizes, validates and resubscribes an active official worker', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', authorization)
    ).resolves.toEqual({
      worker_id: 'worker-1',
      account_id: 'account-1',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      subscribed: true,
    });

    expect(deps.metaWhatsappEmbeddedService.exchangeCode).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      appId: 'app-1',
      appSecret: 'app-secret-1',
      code: 'authorization-code-1',
    });
    expect(
      deps.metaWhatsappEmbeddedService.viewPhoneNumber
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'new-token-1',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
    });
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'new-token-1',
      wabaId: 'waba-1',
    });
    expect(
      deps.officialConnectionRepository.updateActiveAuthorization
    ).toHaveBeenCalledWith({
      accountId: 'account-1',
      connectionId: 'connection-1',
      workerId: 'worker-1',
      businessId: 'business-1',
      accessTokenEncrypted: 'enc:new-token-1',
      tokenType: 'bearer',
      expiresAt: null,
      scope:
        'business_management,whatsapp_business_management,whatsapp_business_messaging',
      apiVersion: 'v25.0',
    });
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('preserves the stored token when Meta omits required permissions', async () => {
    const { useCase, deps } = buildUseCase({
      metaWhatsappEmbeddedService: {
        debugAccessToken: jest.fn(async () => ({
          app_id: 'app-1',
          type: 'SYSTEM_USER',
          is_valid: true,
          issued_at: 1_785_789_163,
          expires_at: 0,
          data_access_expires_at: 0,
          scopes: ['business_management'],
          granular_scopes: [],
        })),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', authorization)
    ).rejects.toThrow(
      'whatsapp_official_reauthorization_insufficient_permissions'
    );

    expect(
      deps.officialConnectionRepository.updateActiveAuthorization
    ).not.toHaveBeenCalled();
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('rejects a different WABA before exchanging or storing credentials', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        ...authorization,
        waba_id: 'waba-2',
      })
    ).rejects.toThrow('whatsapp_official_waba_mismatch');

    expect(
      deps.metaWhatsappEmbeddedService.exchangeCode
    ).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.updateActiveAuthorization
    ).not.toHaveBeenCalled();
  });

  it('fails when worker does not exist', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => null),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', authorization)
    ).rejects.toThrow('worker_not_found');

    expect(
      deps.officialConnectionRepository.findActiveByWorkerId
    ).not.toHaveBeenCalled();
  });

  it('maps Meta subscription failures and never logs the token', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { useCase, deps } = buildUseCase({
      metaWhatsappEmbeddedService: {
        subscribeWabaApp: jest.fn(async () => {
          throw new Error('Meta transport failure');
        }),
      },
    });

    try {
      await expect(
        useCase.execute(t, 'account-1', 'worker-1', authorization)
      ).rejects.toThrow('whatsapp_official_webhook_subscription_failed');

      const logged = JSON.stringify(consoleSpy.mock.calls);
      expect(logged).toContain('worker-1');
      expect(logged).not.toContain('new-token-1');
      expect(logged).not.toContain('enc:old-token');
      expect(
        deps.officialConnectionRepository.updateActiveAuthorization
      ).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
