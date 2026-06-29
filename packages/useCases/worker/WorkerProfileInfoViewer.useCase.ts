import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { WorkerService } from '@core/services/worker.service';
import { ViewProfileInfoResponse } from '@core/schema/worker/viewProfileInfo/response.schema';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  isMetaPermissionsError,
  MetaWhatsappBusinessProfile,
  MetaWhatsappEmbeddedService,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';

@injectable()
export class WorkerProfileInfoViewerUseCase {
  constructor(
    @inject(WorkerProfileInfoService)
    private readonly workerProfileInfoService: WorkerProfileInfoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private mapOfficialProfile(input: {
    workerId: string;
    connectionId: string;
    profile: MetaWhatsappBusinessProfile;
  }): Exclude<ViewProfileInfoResponse, null> {
    return {
      worker_profile_info_id: input.connectionId,
      worker_id: input.workerId,
      name: null,
      message: input.profile.description ?? input.profile.about,
      photo: input.profile.profile_picture_url,
      created_at: null,
      updated_at: null,
      is_official: true,
      about: input.profile.about,
      description: input.profile.description,
      address: input.profile.address,
      email: input.profile.email,
      websites: input.profile.websites,
      vertical: input.profile.vertical,
      profile_picture_url: input.profile.profile_picture_url,
    };
  }

  private async viewOfficialProfile(
    t: TFunction<'translation', undefined>,
    workerId: string
  ): Promise<ViewProfileInfoResponse> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      throw new Error(t('whatsapp_official_connection_not_found'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    let profile;

    try {
      profile = await this.metaWhatsappEmbeddedService.viewBusinessProfile({
        apiVersion: connection.api_version,
        accessToken,
        phoneNumberId: connection.phone_number_id,
      });
    } catch (error) {
      if (isMetaPermissionsError(error)) {
        throw new Error(t('whatsapp_official_profile_permission_error'));
      }

      throw error;
    }

    return this.mapOfficialProfile({
      workerId,
      connectionId: connection.worker_whatsapp_official_connection_id,
      profile,
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ): Promise<ViewProfileInfoResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (isOfficialWhatsappWorker(worker.type?.id)) {
      return this.viewOfficialProfile(t, workerId);
    }

    return this.workerProfileInfoService.viewWorkerProfileInfo(workerId);
  }
}
