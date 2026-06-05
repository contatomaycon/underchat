import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import { WorkerConnectionQrCodeRequest } from '@core/schema/worker/connectionQrCode/request.schema';

export const requestConnectionQrCode = async (
  request: FastifyRequest<{
    Params: WorkerConnectionQrCodeRequest;
  }>,
  reply: FastifyReply
) => {
  const workerConnectionQrCodeRequesterUseCase = container.resolve(
    WorkerConnectionQrCodeRequesterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerConnectionQrCodeRequesterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('worker_external_connection_qrcode_success'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error) {
      const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
        [t('worker_not_found')]: EHTTPStatusCode.not_found,
        [t('worker_qrcode_not_ready')]: EHTTPStatusCode.service_unavailable,
      };
      const httpStatusCode = statusCodeByMessage[error.message];
      if (httpStatusCode) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode,
        });
      }
    }
    handleControllerError(error, reply, t);
  }
};
