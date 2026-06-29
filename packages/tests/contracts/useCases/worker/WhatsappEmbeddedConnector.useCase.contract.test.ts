import 'reflect-metadata';
import { WhatsappEmbeddedConnectorUseCase } from '@core/useCases/worker/WhatsappEmbeddedConnector.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';

const t = ((key: string) => key) as never;

function buildUseCase(overrides: Record<string, unknown> = {}) {
  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };
  const planAccountService = {
    validateCanCreateWorker: jest.fn(async () => undefined),
  };
  const workerService = {
    viewWorkerServer: jest.fn(async () => ({ server_id: 'server-1' })),
    listWorkerServers: jest.fn(async () => [{ server_id: 'server-1' }]),
  };
  const workerConfigService = {
    ensureTypingSimulationDefault: jest.fn(async () => undefined),
    ensureSecurityKeyDefault: jest.fn(async () => undefined),
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
  };
  const passwordEncryptorService = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
  };
  const officialConnectionRepository = {
    findActiveByPhoneNumberId: jest.fn(async () => null),
    createWithWorker: jest.fn(async () => true),
  };

  const deps = {
    accountService,
    planAccountService,
    workerService,
    workerConfigService,
    centrifugoService,
    whatsappEmbeddedService,
    metaWhatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    ...overrides,
  };

  const useCase = new WhatsappEmbeddedConnectorUseCase(
    deps.accountService as never,
    deps.planAccountService as never,
    deps.workerService as never,
    deps.workerConfigService as never,
    deps.centrifugoService as never,
    deps.whatsappEmbeddedService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never
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

    await expect(
      useCase.execute(t, 'account-1', request)
    ).rejects.toThrow('whatsapp_embedded_config_not_configured');

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
      },
    });

    await expect(
      useCase.execute(t, 'account-1', request)
    ).rejects.toThrow('whatsapp_official_code_exchange_failed');

    expect(
      deps.officialConnectionRepository.createWithWorker
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
      },
    });

    await expect(
      useCase.execute(t, 'account-1', request)
    ).rejects.toThrow('whatsapp_official_phone_mismatch');

    expect(
      deps.officialConnectionRepository.createWithWorker
    ).not.toHaveBeenCalled();
  });

  it('creates an official worker without lifecycle queue', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(
      useCase.execute(t, 'account-1', request)
    ).resolves.toMatchObject({
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      number: '5561999990000',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    });

    expect(
      deps.officialConnectionRepository.createWithWorker
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.whatsapp,
        account_id: 'account-1',
        server_id: 'server-1',
        name: 'Official Channel',
        waba_id: 'waba-1',
        phone_number_id: 'phone-1',
        access_token_encrypted: 'enc:token-1',
      })
    );
    expect(
      deps.workerConfigService.ensureTypingSimulationDefault
    ).toHaveBeenCalled();
    expect(
      deps.workerConfigService.ensureSecurityKeyDefault
    ).toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        action: EWorkerAction.create,
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.whatsapp,
      })
    );
  });
});
