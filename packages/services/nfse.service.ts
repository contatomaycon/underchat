import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseViewerRepository } from '@core/repositories/config/NfseViewer.repository';
import { NfseUpdaterRepository } from '@core/repositories/config/NfseUpdater.repository';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseResponse } from '@core/schema/config/updateNfse/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { NfseCertificateStorageService } from '@core/services/nfseCertificateStorage.service';

@injectable()
export class NfseService {
  constructor(
    @inject(NfseViewerRepository)
    private readonly nfseViewerRepository: NfseViewerRepository,
    @inject(NfseUpdaterRepository)
    private readonly nfseUpdaterRepository: NfseUpdaterRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(NfseCertificateStorageService)
    private readonly nfseCertificateStorageService: NfseCertificateStorageService
  ) {}

  viewNfse = async (): Promise<ListNfseResponse | null> => {
    return this.nfseViewerRepository.viewNfse();
  };

  upsertNfse = async (
    t: TFunction<'translation', undefined>,
    input: UpdateNfseRequest
  ): Promise<UpdateNfseResponse> => {
    return this.nfseUpdaterRepository.upsertNfse(t, input);
  };

  uploadNfseCertificate = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    certificate: UploadFileRequest,
    certificatePassword: string
  ): Promise<UpdateNfseResponse> => {
    const current =
      await this.nfseUpdaterRepository.viewDefaultNfseCertificateMetadata();

    if (!current) {
      throw new Error(t('nfse_not_found'));
    }

    let uploaded: {
      bucket: string;
      key: string;
      fileName: string;
      uploadedAt: string;
    };
    try {
      uploaded = await this.nfseCertificateStorageService.uploadCertificate(
        certificate,
        accountId
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'NFSE_CERTIFICATE_INVALID_FORMAT') {
          throw new Error(t('nfse_certificate_invalid_format'));
        }
        if (error.message === 'NFSE_CERTIFICATE_SIZE_LIMIT_EXCEEDED') {
          throw new Error(t('nfse_certificate_size_exceeded'));
        }
      }

      throw error;
    }

    const encryptedPassword =
      this.passwordEncryptorService.encrypt(certificatePassword);

    try {
      const updated = await this.nfseUpdaterRepository.updateNfseCertificate(
        current.nfse_id,
        {
          certificate_bucket: uploaded.bucket,
          certificate_key: uploaded.key,
          certificate_file_name: uploaded.fileName,
          certificate_password_encrypted: encryptedPassword,
          certificate_uploaded_at: uploaded.uploadedAt,
        }
      );

      if (
        current.certificate_bucket &&
        current.certificate_key &&
        current.certificate_key !== uploaded.key
      ) {
        this.nfseCertificateStorageService
          .deleteCertificate(
            current.certificate_bucket,
            current.certificate_key
          )
          .catch(() => undefined);
      }

      return updated;
    } catch (error) {
      await this.nfseCertificateStorageService.deleteCertificate(
        uploaded.bucket,
        uploaded.key
      );

      throw error;
    }
  };
}
