import 'reflect-metadata';
import { WhatsappEmbeddedConnectorUseCase } from '@core/useCases/worker/WhatsappEmbeddedConnector.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { OfficialWhatsappPhoneAlreadyConnectedError } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';

const t = ((key: string) => key) as never;

function buildUseCase(overrides: Record<string, unknown> = {}) {
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const planAccountService = {
    validateCanCreateWorker: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
  };
  const whatsappEmbeddedService = {
    viewInternalConfig: jest.fn(async () => ({
      app_id: 'app-1',
      app_secret: 'secret-1',
      configuration_id: 'cfg-1',
      api_version: 'v24.0',
    })),
  };
  const metaWhatsappEmbeddedService = {
    exchangeCode: jest.fn(async () => ({
      access_token: 'token-1',
      token_type: 'bearer',
      expires_at: '2026-06-29T13:00:00.000Z',
      scope: 'whatsapp_business_management',
    })),
    viewPhoneNumber: jest.fn(async () => ({
      id: 'phone-1',
      display_phone_number: '+55 61 99999-0000',
      verified_name: 'Underchat',
    })),
    listPhoneNumbers: jest.fn(async () => [
      {
        id: 'phone-1',
        display_phone_number: '+55 61 99999-0000',
        verified_name: 'Underchat',
      },
    ]),
    subscribeWabaApp: jest.fn(async () => true),
  };
  const passwordEncryptorService = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };
  const officialConnectionRepository = {
    findActiveByPhoneNumberId: jest.fn(async () => null),
    createWithWorkerAndMigrateChannelAccess: jest.fn(async () => ({
      created: true,
      migrated_user_ids: [],
      migrated_user_channels: [],
    })),
  };
  const redis = {
    del: jest.fn(async () => 1),
  };

  const deps = {
    accountService,
    planAccountService,
    centrifugoService,
    whatsappEmbeddedService,
    metaWhatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    redis,
    ...overrides,
  };

  const useCase = new WhatsappEmbeddedConnectorUseCase(
    deps.accountService as never,
    deps.planAccountService as never,
    deps.centrifugoService as never,
    deps.whatsappEmbeddedService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never,
    deps.redis as never
  );

  return { useCase, deps };
}

const request = {
  name: 'Official Channel',
  code: 'code-1',
  business_id: 'business-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
};

describe('WhatsappEmbeddedConnectorUseCase', () => {
  it('fails when WhatsApp Embedded config is missing', async () => {
    const { useCase, deps } = buildUseCase({
      whatsappEmbeddedService: {
        viewInternalConfig: jest.fn(async () => {
          throw new Error('whatsapp_embedded_config_not_configured');
        }),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).rejects.toThrow(
      'whatsapp_embedded_config_not_configured'
    );

    expect(
      deps.metaWhatsappEmbeddedService.exchangeCode
    ).not.toHaveBeenCalled();
  });

  it('fails when Meta code exchange is invalid', async () => {
    const { useCase, deps } = buildUseCase({
      metaWhatsappEmbeddedService: {
        exchangeCode: jest.fn(async () => {
          throw new Error('invalid code');
        }),
        viewPhoneNumber: jest.fn(),
        listPhoneNumbers: jest.fn(),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).rejects.toThrow(
      'whatsapp_official_code_exchange_failed'
    );

    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).not.toHaveBeenCalled();
  });

  it('fails when Meta returns a different phone number', async () => {
    const { useCase, deps } = buildUseCase({
      metaWhatsappEmbeddedService: {
        exchangeCode: jest.fn(async () => ({
          access_token: 'token-1',
          token_type: 'bearer',
          expires_at: null,
          scope: null,
        })),
        viewPhoneNumber: jest.fn(async () => ({
          id: 'phone-other',
          display_phone_number: '+55 61 99999-0000',
          verified_name: 'Underchat',
        })),
        listPhoneNumbers: jest.fn(),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).rejects.toThrow(
      'whatsapp_official_phone_mismatch'
    );

    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).not.toHaveBeenCalled();
  });

  it('creates an official worker without lifecycle queue', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(
      useCase.execute(t, 'account-1', request)
    ).resolves.toMatchObject({
      account_id: 'account-1',
      server_id: null,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      number: '5561999990000',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    });

    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.whatsapp,
        account_id: 'account-1',
        server_id: null,
        name: 'Official Channel',
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        access_token_encrypted: 'enc:token-1',
      })
    );
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).toHaveBeenCalledWith({
      apiVersion: 'v24.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
        .mock.invocationCallOrder[0]
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.connectionEstablished,
        status: EBaileysConnectionStatus.connected,
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.whatsapp,
        session_ready: true,
        phone: '5561999990000',
      })
    );
  });

  it('invalidates every migrated user scope after reconnecting a phone', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByPhoneNumberId: jest.fn(async () => null),
        createWithWorkerAndMigrateChannelAccess: jest.fn(async () => ({
          created: true,
          migrated_user_ids: ['legacy-user-id'],
          migrated_user_channels: [
            {
              user_id: 'user-1',
              channels: [{ id: 'worker-new', name: 'Worker for user-1' }],
            },
            {
              user_id: 'user-2',
              channels: [{ id: 'worker-new', name: 'Worker for user-2' }],
            },
          ],
        })),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).resolves.toEqual(
      expect.objectContaining({ phone_number_id: 'phone-1' })
    );

    expect(deps.redis.del).toHaveBeenCalledTimes(2);
    expect(deps.redis.del).toHaveBeenCalledWith('userAccessScope:user-1');
    expect(deps.redis.del).toHaveBeenCalledWith('userAccessScope:user-2');
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'chat:account#account-1',
      {
        event: 'user_channels_updated',
        user_id: 'user-1',
        channels: [{ id: 'worker-new', name: 'Worker for user-1' }],
      }
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'chat:account#account-1',
      {
        event: 'user_channels_updated',
        user_id: 'user-2',
        channels: [{ id: 'worker-new', name: 'Worker for user-2' }],
      }
    );
    expect(deps.redis.del).not.toHaveBeenCalledWith(
      'userAccessScope:legacy-user-id'
    );
    const publishedCalls = deps.centrifugoService.publishSub.mock
      .calls as unknown as Array<[string, unknown]>;
    const workerConnectedIndex = publishedCalls.findIndex(
      ([channel]) => channel === 'worker:account#account-1'
    );
    expect(workerConnectedIndex).toBeGreaterThanOrEqual(0);
    for (const [index, [channel]] of publishedCalls.entries()) {
      if (channel === 'chat:account#account-1') {
        expect(
          deps.centrifugoService.publishSub.mock.invocationCallOrder[index]
        ).toBeLessThan(
          deps.centrifugoService.publishSub.mock.invocationCallOrder[
            workerConnectedIndex
          ]
        );
      }
    }
  });

  it('keeps a successful reconnect when access-scope cache or realtime updates fail', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByPhoneNumberId: jest.fn(async () => null),
        createWithWorkerAndMigrateChannelAccess: jest.fn(async () => ({
          created: true,
          migrated_user_ids: ['user-1'],
          migrated_user_channels: [
            {
              user_id: 'user-1',
              channels: [{ id: 'worker-new', name: 'Worker new' }],
            },
          ],
        })),
      },
      redis: {
        del: jest.fn(async () => {
          throw new Error('redis temporarily unavailable');
        }),
      },
      centrifugoService: {
        publishSub: jest.fn(async (channel: string) => {
          if (channel === 'chat:account#account-1') {
            throw new Error('realtime temporarily unavailable');
          }
        }),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', request)
    ).resolves.toMatchObject({ phone_number_id: 'phone-1' });

    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.connectionEstablished,
      })
    );
  });

  it('returns the duplicate-phone message when another connection wins the race', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByPhoneNumberId: jest.fn(async () => null),
        createWithWorkerAndMigrateChannelAccess: jest.fn(async () => {
          throw new OfficialWhatsappPhoneAlreadyConnectedError();
        }),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).rejects.toThrow(
      'whatsapp_official_phone_already_connected'
    );

    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('fails before creating worker when WABA webhook subscription fails', async () => {
    const { useCase, deps } = buildUseCase({
      metaWhatsappEmbeddedService: {
        exchangeCode: jest.fn(async () => ({
          access_token: 'token-1',
          token_type: 'bearer',
          expires_at: null,
          scope: null,
        })),
        viewPhoneNumber: jest.fn(async () => ({
          id: 'phone-1',
          display_phone_number: '+55 61 99999-0000',
          verified_name: 'Underchat',
        })),
        listPhoneNumbers: jest.fn(),
        subscribeWabaApp: jest.fn(async () => false),
      },
    });

    await expect(useCase.execute(t, 'account-1', request)).rejects.toThrow(
      'whatsapp_official_webhook_subscription_failed'
    );

    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('resolves the official phone from WABA when Meta does not send phone id', async () => {
    const { useCase, deps } = buildUseCase();
    const requestWithoutPhoneId = {
      ...request,
      phone_number_id: undefined,
    };

    await expect(
      useCase.execute(t, 'account-1', requestWithoutPhoneId)
    ).resolves.toMatchObject({
      phone_number_id: 'phone-1',
      number: '5561999990000',
    });

    expect(
      deps.metaWhatsappEmbeddedService.listPhoneNumbers
    ).toHaveBeenCalledWith({
      apiVersion: 'v24.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });
    expect(
      deps.officialConnectionRepository.findActiveByPhoneNumberId
    ).toHaveBeenCalledWith('phone-1');
    expect(
      deps.officialConnectionRepository.createWithWorkerAndMigrateChannelAccess
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_number_id: 'phone-1',
      })
    );
  });
});
