import 'reflect-metadata';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerProfileInfoViewerUseCase } from '@core/useCases/worker/WorkerProfileInfoViewer.useCase';
import { WorkerProfileInfoUpserterUseCase } from '@core/useCases/worker/WorkerProfileInfoUpserter.useCase';

const t = ((key: string) => key) as never;

const connection = {
  worker_whatsapp_official_connection_id: 'conn-1',
  worker_id: 'worker-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
  access_token_encrypted: 'encrypted-token',
  api_version: 'v24.0',
};

const metaProfile = {
  about: 'Sobre oficial',
  address: 'Endereco oficial',
  description: 'Descricao oficial',
  email: 'perfil@underchat.test',
  profile_picture_url: 'https://cdn.test/profile.jpg',
  websites: ['https://underchat.test'],
  vertical: 'PROF_SERVICES',
};

function buildDeps() {
  return {
    workerProfileInfoService: {
      viewWorkerProfileInfo: jest.fn(),
      upsertWorkerProfileInfo: jest.fn(),
    },
    workerService: {
      viewWorker: jest.fn(async () => ({
        type: { id: EWorkerType.whatsapp },
      })),
    },
    streamProducerService: {
      send: jest.fn(),
    },
    kafkaBaileysQueueService: {
      workerSendMessage: jest.fn(() => 'topic-profile-info'),
    },
    officialConnectionRepository: {
      findActiveByWorkerId: jest.fn(async () => connection),
    },
    metaWhatsappEmbeddedService: {
      viewBusinessProfile: jest.fn(async () => metaProfile),
      updateBusinessProfile: jest.fn(async () => true),
      uploadProfilePicture: jest.fn(async () => 'profile-picture-handle'),
    },
    passwordEncryptorService: {
      decrypt: jest.fn(() => 'plain-token'),
    },
    whatsappEmbeddedService: {
      viewInternalConfig: jest.fn(async () => ({
        app_id: 'app-1',
        app_secret: 'secret-1',
        configuration_id: 'config-1',
        api_version: 'v25.0',
      })),
    },
  };
}

describe('WorkerProfileInfo official WhatsApp flow', () => {
  it('does not expose official business profile in coexistence mode', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoViewerUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1')
    ).resolves.toBeNull();
    expect(deps.passwordEncryptorService.decrypt).not.toHaveBeenCalled();
    expect(
      deps.metaWhatsappEmbeddedService.viewBusinessProfile
    ).not.toHaveBeenCalled();
    expect(
      deps.workerProfileInfoService.viewWorkerProfileInfo
    ).not.toHaveBeenCalled();
  });

  it('rejects official business profile updates in coexistence mode', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        about: 'Novo sobre',
        description: 'Nova descricao',
        address: 'Nova rua',
        email: 'novo@underchat.test',
        websites: 'https://underchat.test, https://app.underchat.test',
        vertical: 'PROF_SERVICES',
      } as never)
    ).rejects.toThrow('whatsapp_official_profile_info_not_supported');
    expect(
      deps.metaWhatsappEmbeddedService.uploadProfilePicture
    ).not.toHaveBeenCalled();
    expect(
      deps.metaWhatsappEmbeddedService.updateBusinessProfile
    ).not.toHaveBeenCalled();
    expect(
      deps.workerProfileInfoService.upsertWorkerProfileInfo
    ).not.toHaveBeenCalled();
    expect(deps.streamProducerService.send).not.toHaveBeenCalled();
  });

  it('does not validate official category because profile editing is unavailable', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        vertical: 'EnOTHER',
      } as never)
    ).rejects.toThrow('whatsapp_official_profile_info_not_supported');
    expect(
      deps.metaWhatsappEmbeddedService.updateBusinessProfile
    ).not.toHaveBeenCalled();
  });

  it('blocks official profile updates before Meta permission checks', async () => {
    const deps = buildDeps();
    deps.metaWhatsappEmbeddedService.updateBusinessProfile.mockRejectedValueOnce(
      new Error('(#200) Permissions error')
    );
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      {} as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        description: 'Nova descricao',
      } as never)
    ).rejects.toThrow('whatsapp_official_profile_info_not_supported');
    expect(
      deps.metaWhatsappEmbeddedService.updateBusinessProfile
    ).not.toHaveBeenCalled();
    expect(
      deps.workerProfileInfoService.upsertWorkerProfileInfo
    ).not.toHaveBeenCalled();
  });

  it('does not call Meta when viewing official profile in coexistence mode', async () => {
    const deps = buildDeps();
    deps.metaWhatsappEmbeddedService.viewBusinessProfile.mockRejectedValueOnce(
      new Error('(#200) Permissions error')
    );
    const useCase = new WorkerProfileInfoViewerUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1')
    ).resolves.toBeNull();
    expect(
      deps.metaWhatsappEmbeddedService.viewBusinessProfile
    ).not.toHaveBeenCalled();
  });
});
