import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class {},
}));

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { MetaGraphApiError } from '@core/services/metaWhatsappEmbedded.service';
import { WhatsappOfficialHealthViewerUseCase } from '@core/useCases/worker/WhatsappOfficialHealthViewer.useCase';

const t = ((key: string) => key) as never;

const connection = {
  worker_whatsapp_official_connection_id: 'connection-1',
  worker_id: 'worker-1',
  business_id: 'business-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
  access_token_encrypted: 'enc:token-1',
  api_version: 'v25.0',
};

function buildUseCase(overrides: Record<string, unknown> = {}) {
  const workerService = {
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      name: 'Official Channel',
      type: { id: EWorkerType.whatsapp },
    })),
  };
  const chatService = {
    countOpenChatsByWorkerId: jest.fn(async () => 7),
  };
  const metaWhatsappEmbeddedService = {
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
    viewWabaWebhookSubscription: jest.fn(async () => ({
      subscribed: true,
      subscription_count: 1,
    })),
    listDetailedPhoneNumbers: jest.fn(async () => [
      {
        id: 'phone-1',
        display_phone_number: '+55 61 9203-7138',
        verified_name: 'Underchat',
        quality_rating: 'GREEN',
        status: 'CONNECTED',
        throughput_level: 'STANDARD',
        account_mode: 'LIVE',
        code_verification_status: 'VERIFIED',
        messaging_limit_tier: 'TIER_250',
        is_official_business_account: false,
        last_onboarded_time: null,
      },
    ]),
    viewPhoneNumberHealth: jest.fn(async () => ({
      id: 'phone-1',
      display_phone_number: '+55 61 9203-7138',
      verified_name: 'Underchat',
      quality_rating: 'GREEN',
      status: 'CONNECTED',
      throughput_level: 'STANDARD',
      account_mode: 'LIVE',
      code_verification_status: 'VERIFIED',
      messaging_limit_tier: 'TIER_250',
      is_official_business_account: false,
      last_onboarded_time: null,
      is_on_biz_app: true,
      is_pin_enabled: true,
      is_preverified_number: false,
      platform_type: 'CLOUD_API',
      name_status: 'AVAILABLE_WITHOUT_REVIEW',
      quality_score: null,
      webhook_configuration: null,
      health_status: { can_send_message: 'LIMITED' },
    })),
    viewWabaHealth: jest.fn(async () => ({
      id: 'waba-1',
      name: 'Underchat',
      currency: 'USD',
      timezone_id: '25',
      business_verification_status: 'not_verified',
      country: null,
      is_enabled_for_insights: true,
      marketing_messages_lite_api_status: 'ONBOARDED',
      marketing_messages_onboarding_status: 'ONBOARDED',
      health_status: { can_send_message: 'LIMITED' },
    })),
    viewMessageAnalytics: jest.fn(async () => ({
      data_points: [
        {
          start: '10',
          end: '20',
          sent: 67,
          delivered: 67,
          raw: { sent: 67, delivered: 67 },
        },
      ],
      totals: {
        sent: 67,
        delivered: 67,
      },
    })),
    viewConversationAnalytics: jest.fn(async () => ({
      data_points: [],
      totals: {
        conversations: 0,
        cost: 0,
      },
    })),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value.replace('enc:', '')),
  };
  const whatsappEmbeddedService = {
    viewInternalConfig: jest.fn(async () => ({
      app_id: 'app-1',
      app_secret: 'app-secret-1',
      webhook_verify_token: 'verify-1',
      configuration_id: 'configuration-1',
      api_version: 'v25.0',
    })),
  };
  const officialConnectionRepository = {
    findActiveByWorkerId: jest.fn(async () => connection),
  };

  const deps = {
    workerService,
    chatService,
    metaWhatsappEmbeddedService,
    whatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    ...overrides,
  };

  const useCase = new WhatsappOfficialHealthViewerUseCase(
    deps.workerService as never,
    deps.chatService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.whatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never
  );

  return { useCase, deps };
}

describe('WhatsappOfficialHealthViewerUseCase', () => {
  it('returns Meta account health without exposing the decrypted token', async () => {
    const { useCase, deps } = buildUseCase();

    const result = await useCase.execute(t, 'account-1', 'worker-1');

    expect(result).toMatchObject({
      worker_id: 'worker-1',
      account_id: 'account-1',
      connection: {
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        api_version: 'v25.0',
      },
      local: {
        open_conversations: 7,
      },
      phone_numbers: {
        available: true,
        data: {
          total: 1,
        },
      },
      phone_number: {
        available: true,
        data: {
          quality_rating: 'GREEN',
          messaging_limit_tier: 'TIER_250',
          is_on_biz_app: true,
        },
      },
      analytics: {
        messages: {
          available: true,
          data: {
            totals: {
              sent: 67,
              delivered: 67,
            },
          },
        },
        conversations: {
          available: true,
          data: {
            totals: {
              conversations: 0,
              cost: 0,
            },
          },
        },
      },
      diagnostics: {
        reauthentication_required: false,
        token: {
          available: true,
          data: {
            valid: true,
            app_matches_config: true,
            missing_scopes: [],
            does_not_expire: true,
          },
        },
        webhook_subscription: {
          available: true,
          data: {
            subscribed: true,
          },
        },
      },
    });
    expect(result.warnings).toEqual([]);
    expect(deps.passwordEncryptorService.decrypt).toHaveBeenCalledWith(
      'enc:token-1'
    );
    expect(
      deps.metaWhatsappEmbeddedService.viewWabaHealth
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('token-1');
    expect(serialized).not.toContain('enc:token-1');
  });

  it('fails when worker does not exist', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => null),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );

    expect(
      deps.officialConnectionRepository.findActiveByWorkerId
    ).not.toHaveBeenCalled();
  });

  it('fails when worker is not official WhatsApp', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => ({
          id: 'worker-1',
          type: { id: EWorkerType.baileys },
        })),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_disconnect_only_official'
    );

    expect(
      deps.officialConnectionRepository.findActiveByWorkerId
    ).not.toHaveBeenCalled();
  });

  it('fails when the official channel has no active official connection', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByWorkerId: jest.fn(async () => null),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_connection_not_found'
    );

    expect(deps.passwordEncryptorService.decrypt).not.toHaveBeenCalled();
  });

  it('keeps the response available and reports when one optional Meta call fails', async () => {
    const { useCase } = buildUseCase({
      metaWhatsappEmbeddedService: {
        ...buildUseCase().deps.metaWhatsappEmbeddedService,
        viewMessageAnalytics: jest.fn(async () => {
          throw new Error('Meta analytics failed');
        }),
      },
    });

    const result = await useCase.execute(t, 'account-1', 'worker-1');

    expect(result.analytics.messages).toEqual({
      available: false,
      data: null,
      error: {
        message: 'Meta analytics failed',
        type: null,
        code: null,
        error_subcode: null,
      },
    });
    expect(result.warnings).toEqual(['meta_health_warning_partial_data']);
  });

  it('identifies when the stored token no longer has access to Meta assets', async () => {
    const accessError = new MetaGraphApiError({
      message: 'Unsupported get request',
      code: 100,
      error_subcode: 33,
      type: 'GraphMethodException',
    });
    const { useCase } = buildUseCase({
      metaWhatsappEmbeddedService: {
        ...buildUseCase().deps.metaWhatsappEmbeddedService,
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
        viewWabaHealth: jest.fn(async () => {
          throw accessError;
        }),
        viewPhoneNumberHealth: jest.fn(async () => {
          throw accessError;
        }),
        listDetailedPhoneNumbers: jest.fn(async () => {
          throw accessError;
        }),
        viewWabaWebhookSubscription: jest.fn(async () => {
          throw accessError;
        }),
      },
    });

    const result = await useCase.execute(t, 'account-1', 'worker-1');

    expect(result.diagnostics.reauthentication_required).toBe(true);
    expect(result.diagnostics.token.data?.missing_scopes).toEqual([
      'whatsapp_business_management',
      'whatsapp_business_messaging',
    ]);
    expect(result.waba.error).toMatchObject({
      code: 100,
      error_subcode: 33,
      type: 'GraphMethodException',
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'meta_health_warning_reauthentication_required',
        'meta_health_warning_partial_data',
      ])
    );
  });
});
