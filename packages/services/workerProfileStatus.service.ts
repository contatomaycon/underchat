import { injectable } from 'tsyringe';
import { WorkerProfileStatusCreatorTransactionRepository } from '@core/repositories/worker/WorkerProfileStatusCreatorTransaction.repository';
import { WorkerProfileStatusListerRepository } from '@core/repositories/worker/WorkerProfileStatusLister.repository';
import { WorkerProfileStatusUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusUpdater.repository';
import { WorkerProfileStatusDeleterTransactionRepository } from '@core/repositories/worker/WorkerProfileStatusDeleterTransaction.repository';
import { WorkerProfileStatusViewerRepository } from '@core/repositories/worker/WorkerProfileStatusViewer.repository';
import { WorkerProfileStatusContactListerRepository } from '@core/repositories/worker/WorkerProfileStatusContactLister.repository';
import { WorkerProfileStatusExternalIdUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusExternalIdUpdater.repository';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { WorkerProfileStatus } from '@core/schema/worker/uploadProfileStatus/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { StorageService } from '@core/services/storage.service';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { IProfileStatusMessage } from '@core/common/interfaces/IProfileStatusMessage';
import { IProfileStatusDeleteMessage } from '@core/common/interfaces/IProfileStatusDeleteMessage';
import { IVisibilityData } from '@core/common/interfaces/IVisibilityData';
import { ContactService } from '@core/services/contact.service';
import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';
import { TFunction } from 'i18next';

@injectable()
export class WorkerProfileStatusService {
  constructor(
    private readonly workerProfileStatusCreatorTransactionRepository: WorkerProfileStatusCreatorTransactionRepository,
    private readonly workerProfileStatusListerRepository: WorkerProfileStatusListerRepository,
    private readonly workerProfileStatusUpdaterRepository: WorkerProfileStatusUpdaterRepository,
    private readonly workerProfileStatusDeleterTransactionRepository: WorkerProfileStatusDeleterTransactionRepository,
    private readonly workerProfileStatusViewerRepository: WorkerProfileStatusViewerRepository,
    private readonly workerProfileStatusContactListerRepository: WorkerProfileStatusContactListerRepository,
    private readonly workerProfileStatusExternalIdUpdaterRepository: WorkerProfileStatusExternalIdUpdaterRepository,
    private readonly storageService: StorageService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly contactService: ContactService
  ) {}

  async uploadProfileStatus(
    t: TFunction<'translation', undefined>,
    workerId: string,
    accountId: string,
    workerProfileStatusTypeId: string,
    photos?: UploadFileRequest | UploadFileRequest[],
    text?: string,
    caption?: string,
    isPermanent: boolean = false,
    visibilityData?: IVisibilityData
  ): Promise<WorkerProfileStatus[]> {
    const typeId = workerProfileStatusTypeId as EWorkerProfileStatusType;

    if (typeId === EWorkerProfileStatusType.text) {
      if (!text) {
        throw new Error('TEXT_REQUIRED');
      }

      if (!visibilityData) {
        throw new Error('VISIBILITY_DATA_REQUIRED');
      }

      const workerProfileStatusId =
        await this.workerProfileStatusCreatorTransactionRepository.createWorkerProfileStatus(
          t,
          accountId,
          {
            worker_id: workerId,
            worker_profile_status_type_id: typeId,
            value: text,
            is_permanent: isPermanent,
          },
          visibilityData
        );

      const statusResult = {
        worker_profile_status_id: workerProfileStatusId,
        worker_id: workerId,
        worker_profile_status_type_id: typeId,
        value: text,
        is_permanent: isPermanent,
      } as WorkerProfileStatus;

      await this.sendStatusToKafka(statusResult, accountId);

      return [statusResult];
    }

    if (!photos) {
      throw new Error('FILES_REQUIRED');
    }

    const photosArray = Array.isArray(photos) ? photos : [photos];
    const uploadPromises = photosArray.map(async (photo) => {
      let uploadResult;

      if (typeId === EWorkerProfileStatusType.image) {
        uploadResult = await this.storageService.uploadImage(photo, accountId);
      }
      if (typeId === EWorkerProfileStatusType.video) {
        uploadResult = await this.storageService.uploadVideo(photo, accountId);
      }
      if (typeId === EWorkerProfileStatusType.audio) {
        uploadResult = await this.storageService.uploadAudio(photo, accountId);
      }

      if (!uploadResult) {
        throw new Error('INVALID_TYPE');
      }

      let value = uploadResult.url;
      if (
        caption &&
        (typeId === EWorkerProfileStatusType.image ||
          typeId === EWorkerProfileStatusType.video ||
          typeId === EWorkerProfileStatusType.audio)
      ) {
        value = `${uploadResult.url}|${caption}`;
      }

      if (!visibilityData) {
        throw new Error('VISIBILITY_DATA_REQUIRED');
      }

      const workerProfileStatusId =
        await this.workerProfileStatusCreatorTransactionRepository.createWorkerProfileStatus(
          t,
          accountId,
          {
            worker_id: workerId,
            worker_profile_status_type_id: typeId,
            value,
            is_permanent: isPermanent,
          },
          visibilityData
        );

      const statusResult = {
        worker_profile_status_id: workerProfileStatusId,
        worker_id: workerId,
        worker_profile_status_type_id: typeId,
        value,
        is_permanent: isPermanent,
      } as WorkerProfileStatus;

      await this.sendStatusToKafka(statusResult, accountId);

      return statusResult;
    });

    const results = await Promise.all(uploadPromises);

    return results.filter(
      (status): status is WorkerProfileStatus => status !== null
    );
  }

  async listProfileStatus(workerId: string): Promise<ProfileStatus[]> {
    return this.workerProfileStatusListerRepository.listWorkerProfileStatus(
      workerId
    );
  }

  async updateIsPermanent(
    workerProfileStatusId: string,
    isPermanent: boolean
  ): Promise<boolean> {
    return this.workerProfileStatusUpdaterRepository.updateIsPermanent(
      workerProfileStatusId,
      isPermanent
    );
  }

  async deleteProfileStatus(
    workerProfileStatusId: string,
    accountId: string
  ): Promise<boolean> {
    const profileStatus =
      await this.workerProfileStatusViewerRepository.viewWorkerProfileStatusById(
        workerProfileStatusId
      );

    if (!profileStatus) {
      return false;
    }

    if (profileStatus.external_id) {
      const contacts =
        await this.workerProfileStatusContactListerRepository.listContactsByStatusId(
          workerProfileStatusId
        );

      const statusJidList: string[] = [];

      for (const contactData of contacts) {
        const decryptedPhone = this.contactService.getContactPhoneDecrypted(
          contactData.phone
        );

        if (!decryptedPhone) {
          continue;
        }

        const jid = normalizePhoneToJid(decryptedPhone, contactData.phone_ddi);

        if (jid) {
          statusJidList.push(jid);
        }
      }

      await this.sendDeleteStatusToKafka(
        profileStatus.worker_id,
        accountId,
        workerProfileStatusId,
        profileStatus.external_id,
        statusJidList
      );
    }

    if (
      profileStatus.worker_profile_status_type_id ===
      EWorkerProfileStatusType.text
    ) {
      return this.workerProfileStatusDeleterTransactionRepository.deleteWorkerProfileStatus(
        workerProfileStatusId
      );
    }

    const url = profileStatus.value.split('|')[0];
    const deleteFromS3 = await this.storageService.deleteImage(url);

    if (!deleteFromS3) {
      return false;
    }

    return this.workerProfileStatusDeleterTransactionRepository.deleteWorkerProfileStatus(
      workerProfileStatusId
    );
  }

  private async sendDeleteStatusToKafka(
    workerId: string,
    accountId: string,
    workerProfileStatusId: string,
    externalId: string,
    statusJidList: string[]
  ): Promise<void> {
    try {
      const deleteMessage: IProfileStatusDeleteMessage = {
        worker_id: workerId,
        account_id: accountId,
        worker_profile_status_id: workerProfileStatusId,
        external_id: externalId,
        statusJidList,
      };

      const topic = this.kafkaBaileysQueueService.workerSendMessage(workerId);

      await this.streamProducerService.send(topic, deleteMessage);
    } catch (error) {
      console.error('Error sending delete status to Kafka:', error);
    }
  }

  async updateExternalId(
    workerProfileStatusId: string,
    externalId: string
  ): Promise<boolean> {
    return this.workerProfileStatusExternalIdUpdaterRepository.updateExternalId(
      workerProfileStatusId,
      externalId
    );
  }

  private async sendStatusToKafka(
    status: WorkerProfileStatus,
    accountId: string
  ): Promise<void> {
    try {
      const contacts =
        await this.workerProfileStatusContactListerRepository.listContactsByStatusId(
          status.worker_profile_status_id
        );

      const statusJidList: string[] = [];

      for (const contactData of contacts) {
        const decryptedPhone = this.contactService.getContactPhoneDecrypted(
          contactData.phone
        );

        if (!decryptedPhone) {
          continue;
        }

        const jid = normalizePhoneToJid(decryptedPhone, contactData.phone_ddi);

        if (jid) {
          statusJidList.push(jid);
        }
      }

      const statusMessage: IProfileStatusMessage = {
        worker_id: status.worker_id,
        account_id: accountId,
        worker_profile_status_id: status.worker_profile_status_id,
        worker_profile_status_type_id:
          status.worker_profile_status_type_id as EWorkerProfileStatusType,
        value: status.value,
        is_permanent: status.is_permanent,
        statusJidList,
      };

      const topic = this.kafkaBaileysQueueService.workerSendMessage(
        status.worker_id
      );

      await this.streamProducerService.send(topic, statusMessage);
    } catch (error) {
      console.error('Error sending profile status to Kafka:', error);
    }
  }
}
