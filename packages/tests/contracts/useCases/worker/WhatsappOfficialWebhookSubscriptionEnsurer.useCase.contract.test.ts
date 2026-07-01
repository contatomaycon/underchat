import 'reflect-metadata';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WhatsappOfficialWebhookSubscriptionEnsurerUseCase } from '@core/useCases/worker/WhatsappOfficialWebhookSubscriptionEnsurer.useCase';

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
  const metaWhatsappEmbeddedService = {
    subscribeWabaApp: jest.fn(async () => true),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value.replace('enc:', '')),
  };
  const officialConnectionRepository = {
    findActiveByWorkerId: jest.fn(async () => connection),
  };

  const deps = {
    workerService,
    metaWhatsappEmbeddedService,
    passwordEncryptorService,
    officialConnectionRepository,
    ...overrides,
  };

  const useCase = new WhatsappOfficialWebhookSubscriptionEnsurerUseCase(
    deps.workerService as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.passwordEncryptorService as never,
    deps.officialConnectionRepository as never
  );

  return { useCase, deps };
}

describe('WhatsappOfficialWebhookSubscriptionEnsurerUseCase', () => {
  it('resubscribes an active official worker without exposing token', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toEqual({
      worker_id: 'worker-1',
      account_id: 'account-1',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      subscribed: true,
    });

    expect(deps.workerService.viewWorker).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );
    expect(deps.passwordEncryptorService.decrypt).toHaveBeenCalledWith(
      'enc:token-1'
    );
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'token-1',
      wabaId: 'waba-1',
    });
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
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('fails when worker is not official', async () => {
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
    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('fails when official worker has no active official connection', async () => {
    const { useCase, deps } = buildUseCase({
      officialConnectionRepository: {
        findActiveByWorkerId: jest.fn(async () => null),
      },
    });

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_connection_not_found'
    );

    expect(
      deps.metaWhatsappEmbeddedService.subscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('maps Meta subscription failure and logs context without token', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { useCase } = buildUseCase({
      metaWhatsappEmbeddedService: {
        subscribeWabaApp: jest.fn(async () => {
          throw new Error('Meta error');
        }),
      },
    });

    try {
      await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
        'whatsapp_official_webhook_subscription_failed'
      );

      const logged = JSON.stringify(consoleSpy.mock.calls);
      expect(logged).toContain('worker-1');
      expect(logged).toContain('waba-1');
      expect(logged).toContain('phone-1');
      expect(logged).not.toContain('token-1');
      expect(logged).not.toContain('enc:token-1');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
