import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerExternalConnectionQrCodeRequester.useCase';
import { WorkerExternalConnectionRequest } from '@core/schema/worker/externalConnection/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';

export const requestExternalConnectionQrCode = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionRequest;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionQrCodeRequesterUseCase = container.resolve(
    WorkerExternalConnectionQrCodeRequesterUseCase
  );
  const { t } = request;

  try {
    await workerExternalConnectionQrCodeRequesterUseCase.execute(
      t,
      request.params.token
    );

    return sendResponse(reply, {
      message: t('worker_external_connection_qrcode_success'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleExternalConnectionError(error, reply, t);
  }
};
