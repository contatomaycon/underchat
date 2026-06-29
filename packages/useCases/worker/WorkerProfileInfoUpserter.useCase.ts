import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { WorkerProfileInfoService } from '@core/services/workerProfileInfo.service';
import { WorkerService } from '@core/services/worker.service';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { UploadProfileInfoResponse } from '@core/schema/worker/uploadProfileInfo/response.schema';
import { UploadProfileInfoRequest } from '@core/schema/worker/uploadProfileInfo/request.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { IProfileInfoMessage } from '@core/common/interfaces/IProfileInfoMessage';
import { isOfficialWhatsappWorker } from '@core/common/functions/workerOfficialCapabilities';
import { WorkerWhatsappOfficialConnectionRepository } from '@core/repositories/whatsapp/WorkerWhatsappOfficialConnection.repository';
import {
  MetaWhatsappBusinessProfile,
  MetaWhatsappEmbeddedService,
  UpdateMetaWhatsappBusinessProfile,
} from '@core/services/metaWhatsappEmbedded.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WhatsappEmbeddedService } from '@core/services/whatsappEmbedded.service';

@injectable()
export class WorkerProfileInfoUpserterUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    @inject(WorkerProfileInfoService)
    private readonly workerProfileInfoService: WorkerProfileInfoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(WorkerWhatsappOfficialConnectionRepository)
    private readonly workerWhatsappOfficialConnectionRepository: WorkerWhatsappOfficialConnectionRepository,
    @inject(MetaWhatsappEmbeddedService)
    private readonly metaWhatsappEmbeddedService: MetaWhatsappEmbeddedService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(WhatsappEmbeddedService)
    private readonly whatsappEmbeddedService: WhatsappEmbeddedService
  ) {}

  private normalizeField(field: unknown): string | undefined {
    if (field === undefined || field === null) return undefined;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      const value = (field as { value: unknown }).value;

      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return undefined;
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }

      return undefined;
    }

    if (typeof field === 'number' || typeof field === 'boolean') {
      return String(field);
    }

    return undefined;
  }

  private normalizeBooleanField(field: unknown): boolean {
    if (field === undefined || field === null) return false;
    if (typeof field === 'boolean') return field;
    if (typeof field === 'object' && field !== null && 'value' in field) {
      return this.normalizeBooleanField((field as { value: unknown }).value);
    }
    if (typeof field === 'string') {
      const normalized = field.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return false;
  }

  private normalizeNullableField(field: unknown): string | null | undefined {
    const value = this.normalizeField(field);
    if (value === undefined) return undefined;

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private normalizeWebsitesField(field: unknown): string[] | undefined {
    const value = this.normalizeField(field);
    if (value === undefined) return undefined;

    const normalized = value.trim();
    if (!normalized) return [];

    try {
      const parsed = JSON.parse(normalized) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // Falls back to comma/newline parsing for multipart text fields.
    }

    return normalized
      .split(/[\n,]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<Buffer> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }

    return buffer;
  }

  private mapOfficialProfile(input: {
    workerId: string;
    connectionId: string;
    profile: MetaWhatsappBusinessProfile;
  }): UploadProfileInfoResponse {
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

  private buildOfficialProfilePayload(
    body: UploadProfileInfoRequest
  ): UpdateMetaWhatsappBusinessProfile {
    const payload: UpdateMetaWhatsappBusinessProfile = {};

    const about = this.normalizeNullableField(body.about);
    if (about !== undefined) payload.about = about;

    const description = this.normalizeNullableField(body.description);
    const message = this.normalizeNullableField(body.message);
    if (description !== undefined) {
      payload.description = description;
    } else if (message !== undefined) {
      payload.description = message;
    }

    const address = this.normalizeNullableField(body.address);
    if (address !== undefined) payload.address = address;

    const email = this.normalizeNullableField(body.email);
    if (email !== undefined) payload.email = email;

    const websites = this.normalizeWebsitesField(body.websites);
    if (websites !== undefined) payload.websites = websites;

    const vertical = this.normalizeNullableField(body.vertical);
    if (vertical !== undefined) payload.vertical = vertical;

    const profilePictureHandle = this.normalizeNullableField(
      body.profile_picture_handle
    );
    if (profilePictureHandle !== undefined) {
      payload.profile_picture_handle = profilePictureHandle;
    }

    return payload;
  }

  private async updateOfficialProfile(
    t: TFunction<'translation', undefined>,
    workerId: string,
    body: UploadProfileInfoRequest
  ): Promise<UploadProfileInfoResponse> {
    const connection =
      await this.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId(
        workerId
      );

    if (!connection) {
      throw new Error(t('whatsapp_official_connection_not_found'));
    }

    if (this.normalizeBooleanField(body.remove_photo)) {
      throw new Error(t('whatsapp_official_runtime_action_not_supported'));
    }

    const accessToken = this.passwordEncryptorService.decrypt(
      connection.access_token_encrypted
    );
    const payload = this.buildOfficialProfilePayload(body);

    if (body.photo) {
      const fileBuffer = await this.validateFileSize(body.photo, t);
      const config = await this.whatsappEmbeddedService.viewInternalConfig(t);
      payload.profile_picture_handle =
        await this.metaWhatsappEmbeddedService.uploadProfilePicture({
          apiVersion: connection.api_version,
          accessToken,
          appId: config.app_id,
          filename: body.photo.filename,
          fileType: body.photo.mimetype ?? 'image/jpeg',
          fileBuffer,
        });
    }

    await this.metaWhatsappEmbeddedService.updateBusinessProfile({
      apiVersion: connection.api_version,
      accessToken,
      phoneNumberId: connection.phone_number_id,
      data: payload,
    });
    const profile = await this.metaWhatsappEmbeddedService.viewBusinessProfile({
      apiVersion: connection.api_version,
      accessToken,
      phoneNumberId: connection.phone_number_id,
    });

    return this.mapOfficialProfile({
      workerId,
      connectionId: connection.worker_whatsapp_official_connection_id,
      profile,
    });
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    body: UploadProfileInfoRequest
  ): Promise<UploadProfileInfoResponse> {
    const worker = await this.workerService.viewWorker(accountId, workerId);

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (isOfficialWhatsappWorker(worker.type?.id)) {
      return this.updateOfficialProfile(t, workerId, body);
    }

    const name = this.normalizeField(body.name);
    const message = this.normalizeField(body.message);
    const removePhoto = this.normalizeBooleanField(body.remove_photo);
    let photo: UploadFileRequest | null = null;

    if (body.photo && body.photo !== null && !removePhoto) {
      photo = body.photo;
      await this.validateFileSize(photo, t);
    }

    const result = await this.workerProfileInfoService.upsertWorkerProfileInfo(
      t,
      workerId,
      accountId,
      name || null,
      message || null,
      photo,
      removePhoto
    );

    if (!result) {
      throw new Error(t('profile_info_upload_error'));
    }

    const profileInfoMessage: IProfileInfoMessage = {
      worker_id: workerId,
      account_id: accountId,
      name: result.name,
      message: result.message,
      photo: result.photo,
    };

    const topic = this.kafkaBaileysQueueService.workerSendMessage(workerId);

    await this.streamProducerService.send(
      topic,
      profileInfoMessage,
      `profile_info:${workerId}:${accountId}`
    );

    return result;
  }
}
