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
  it('views official business profile with stored Meta token', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoViewerUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      deps.officialConnectionRepository as never,
      deps.metaWhatsappEmbeddedService as never,
      deps.passwordEncryptorService as never,
      deps.whatsappEmbeddedService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1')
    ).resolves.toMatchObject({
      worker_profile_info_id: 'conn-1',
      worker_id: 'worker-1',
      is_official: true,
      name: null,
      message: 'Descricao oficial',
      photo: 'https://cdn.test/profile.jpg',
      about: 'Sobre oficial',
      description: 'Descricao oficial',
      websites: ['https://underchat.test'],
      vertical: 'PROF_SERVICES',
    });
    expect(deps.passwordEncryptorService.decrypt).toHaveBeenCalledWith(
      'encrypted-token'
    );
    expect(
      deps.metaWhatsappEmbeddedService.viewBusinessProfile
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'plain-token',
      phoneNumberId: 'phone-1',
    });
    expect(
      deps.workerProfileInfoService.viewWorkerProfileInfo
    ).not.toHaveBeenCalled();
  });

  it('updates official business profile without local Baileys queue', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      deps.streamProducerService as never,
      deps.kafkaBaileysQueueService as never,
      deps.officialConnectionRepository as never,
      deps.metaWhatsappEmbeddedService as never,
      deps.passwordEncryptorService as never,
      deps.whatsappEmbeddedService as never
    );

    const photo = {
      filename: 'profile.jpg',
      mimetype: 'image/jpeg',
      toBuffer: jest.fn(async () => Buffer.from('profile-picture')),
    };

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        about: 'Novo sobre',
        description: 'Nova descricao',
        address: 'Nova rua',
        email: 'novo@underchat.test',
        websites: 'https://underchat.test, https://app.underchat.test',
        vertical: 'PROF_SERVICES',
        photo,
      } as never)
    ).resolves.toMatchObject({
      is_official: true,
      worker_id: 'worker-1',
      profile_picture_url: 'https://cdn.test/profile.jpg',
    });
    expect(
      deps.metaWhatsappEmbeddedService.uploadProfilePicture
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'plain-token',
      appId: 'app-1',
      filename: 'profile.jpg',
      fileType: 'image/jpeg',
      fileBuffer: Buffer.from('profile-picture'),
    });
    expect(
      deps.metaWhatsappEmbeddedService.updateBusinessProfile
    ).toHaveBeenCalledWith({
      apiVersion: 'v25.0',
      accessToken: 'plain-token',
      phoneNumberId: 'phone-1',
      data: {
        about: 'Novo sobre',
        description: 'Nova descricao',
        address: 'Nova rua',
        email: 'novo@underchat.test',
        websites: ['https://underchat.test', 'https://app.underchat.test'],
        vertical: 'PROF_SERVICES',
        profile_picture_handle: 'profile-picture-handle',
      },
    });
    expect(
      deps.workerProfileInfoService.upsertWorkerProfileInfo
    ).not.toHaveBeenCalled();
    expect(deps.streamProducerService.send).not.toHaveBeenCalled();
  });

  it('rejects invalid official business profile category before calling Meta', async () => {
    const deps = buildDeps();
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      deps.streamProducerService as never,
      deps.kafkaBaileysQueueService as never,
      deps.officialConnectionRepository as never,
      deps.metaWhatsappEmbeddedService as never,
      deps.passwordEncryptorService as never,
      deps.whatsappEmbeddedService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        vertical: 'EnOTHER',
      } as never)
    ).rejects.toThrow('whatsapp_profile_category_invalid');
    expect(
      deps.metaWhatsappEmbeddedService.updateBusinessProfile
    ).not.toHaveBeenCalled();
  });

  it('maps Meta permissions error when updating official profile', async () => {
    const deps = buildDeps();
    deps.metaWhatsappEmbeddedService.updateBusinessProfile.mockRejectedValueOnce(
      new Error('(#200) Permissions error')
    );
    const useCase = new WorkerProfileInfoUpserterUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      deps.streamProducerService as never,
      deps.kafkaBaileysQueueService as never,
      deps.officialConnectionRepository as never,
      deps.metaWhatsappEmbeddedService as never,
      deps.passwordEncryptorService as never,
      deps.whatsappEmbeddedService as never
    );

    await expect(
      useCase.execute(t, 'account-1', 'worker-1', {
        description: 'Nova descricao',
      } as never)
    ).rejects.toThrow('whatsapp_official_profile_permission_error');
    expect(
      deps.workerProfileInfoService.upsertWorkerProfileInfo
    ).not.toHaveBeenCalled();
  });

  it('maps Meta permissions error when viewing official profile', async () => {
    const deps = buildDeps();
    deps.metaWhatsappEmbeddedService.viewBusinessProfile.mockRejectedValueOnce(
      new Error('(#200) Permissions error')
    );
    const useCase = new WorkerProfileInfoViewerUseCase(
      deps.workerProfileInfoService as never,
      deps.workerService as never,
      deps.officialConnectionRepository as never,
      deps.metaWhatsappEmbeddedService as never,
      deps.passwordEncryptorService as never,
      deps.whatsappEmbeddedService as never
    );

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_profile_permission_error'
    );
  });
});
