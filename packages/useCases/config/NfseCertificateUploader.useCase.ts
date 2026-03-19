import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { NfseService } from '@core/services/nfse.service';
import { UploadNfseCertificateRequest } from '@core/schema/config/uploadNfseCertificate/request.schema';
import { UploadNfseCertificateResponse } from '@core/schema/config/uploadNfseCertificate/response.schema';

@injectable()
export class NfseCertificateUploaderUseCase {
  constructor(
    @inject(NfseService)
    private readonly nfseService: NfseService
  ) {}

  private normalizeStringField(field: unknown): string | undefined {
    if (typeof field === 'string') {
      return field;
    }

    if (
      typeof field === 'object' &&
      field !== null &&
      'value' in field &&
      typeof (field as { value: unknown }).value === 'string'
    ) {
      return (field as { value: string }).value;
    }

    return undefined;
  }

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: UploadNfseCertificateRequest
  ): Promise<UploadNfseCertificateResponse> => {
    const certificate = body.certificate;
    if (!certificate) {
      throw new Error(t('nfse_certificate_file_required'));
    }

    const certificatePassword = this.normalizeStringField(
      body.certificate_password
    );

    if (!certificatePassword || certificatePassword.trim().length === 0) {
      throw new Error(t('nfse_certificate_password_required'));
    }

    return this.nfseService.uploadNfseCertificate(
      t,
      accountId,
      certificate,
      certificatePassword.trim()
    );
  };
}
