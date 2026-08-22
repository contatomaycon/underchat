import 'reflect-metadata';
import { WhatsappOfficialConnectorUseCase } from '@core/useCases/worker/WhatsappOfficialConnector.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { OfficialWhatsappPhoneAlreadyConnectedError } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';

const t = ((key: string) => key) as never;

const request = {
  code: 'code-1',
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
      server: null,
    })),
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
    findActiveByWorkerId: jest.fn(async () => null),
    findActiveByPhoneNumberId: jest.fn(async () => null),
    createForExistingWorker: jest.fn(async () => true),
  };

  const deps = {
    workerService,
    centrifugoService,
    whatsappEmbeddedService,
    metaWhatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    ...overrides,
  };

  const useCase = new WhatsappOfficialConnectorUseCase(
    deps.workerService as never,
    deps.centrifugoService as never,
    deps.whatsappEmbeddedService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never
  );

  return { useCase, deps };
}

describe('WhatsappOfficialConnectorUseCase', () => {
  it('reconnects an existing official worker and publishes online status', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).resolves.toEqual({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: null,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.online,
      number: '5561999990000',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
    });

    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        number: '5561999990000',
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
      deps.officialConnectionRepository.createForExistingWorker.mock
        .invocationCallOrder[0]
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.connectionEstablished,
        status: EBaileysConnectionStatus.connected,
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.online,
        phone: '5561999990000',
        session_ready: true,
      })
    );
  });

  it('fails before reconnecting worker when WABA webhook subscription fails', async () => {
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

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).rejects.toThrow('whatsapp_official_webhook_subscription_failed');

    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('rejects non-official workers', async () => {
    const { useCase, deps } = buildUseCase({
      workerService: {
        viewWorker: jest.fn(async () => ({
          id: 'worker-1',
          name: 'Socket',
          type: { id: EWorkerType.baileys },
        })),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).rejects.toThrow('whatsapp_official_disconnect_only_official');

    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).not.toHaveBeenCalled();
  });

  it('rejects official workers that already have an active connection', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByWorkerId: jest.fn(async () => ({ worker_id: 'worker-1' })),
        findActiveByPhoneNumberId: jest.fn(),
        createForExistingWorker: jest.fn(),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).rejects.toThrow('whatsapp_official_already_connected');

    expect(
      deps.metaWhatsappEmbeddedService.exchangeCode
    ).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).not.toHaveBeenCalled();
  });

  it('rejects when the selected official phone is already active in another worker', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByWorkerId: jest.fn(async () => null),
        findActiveByPhoneNumberId: jest.fn(async () => ({
          worker_id: 'worker-other',
          phone_number_id: 'phone-1',
        })),
        createForExistingWorker: jest.fn(),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).rejects.toThrow('whatsapp_official_phone_already_connected');

    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).not.toHaveBeenCalled();
  });

  it('returns the duplicate-phone message when another connection wins the race', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByWorkerId: jest.fn(async () => null),
        findActiveByPhoneNumberId: jest.fn(async () => null),
        createForExistingWorker: jest.fn(async () => {
          throw new OfficialWhatsappPhoneAlreadyConnectedError();
        }),
      },
    });

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', request)
    ).rejects.toThrow('whatsapp_official_phone_already_connected');

    expect(
      deps.officialConnectionRepository.createForExistingWorker
    ).toHaveBeenCalledTimes(1);
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
