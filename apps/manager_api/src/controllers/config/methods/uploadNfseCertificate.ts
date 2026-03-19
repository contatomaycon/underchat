import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NfseCertificateUploaderUseCase } from '@core/useCases/config/NfseCertificateUploader.useCase';
import { UploadNfseCertificateRequest } from '@core/schema/config/uploadNfseCertificate/request.schema';

export const uploadNfseCertificate = async (
  request: FastifyRequest<{
    Body: UploadNfseCertificateRequest;
  }>,
  reply: FastifyReply
) => {
  const nfseCertificateUploaderUseCase = container.resolve(
    NfseCertificateUploaderUseCase
  );
  const { t, tokenJwtData, body } = request;

  try {
    const response = await nfseCertificateUploaderUseCase.execute(
      t,
      tokenJwtData.account_id,
      body
    );

    return sendResponse(reply, {
      message: t('nfse_certificate_uploaded_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
