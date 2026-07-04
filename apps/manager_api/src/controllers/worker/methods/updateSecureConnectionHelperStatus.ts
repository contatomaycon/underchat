import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import {
  WorkerSecureConnectionHelperParams,
  WorkerSecureConnectionHelperStatusBody,
} from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';

export const updateSecureConnectionHelperStatus = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionHelperParams;
    Body: WorkerSecureConnectionHelperStatusBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t } = request;

  try {
    const response = await useCase.updateHelperStatus(t, {
      token: request.params.token,
      status: request.body.status,
      helperVersion: request.body.helper_version,
      helperPlatform: request.body.helper_platform,
      message: request.body.message,
      error: request.body.error,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_status_updated'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleSecureConnectionError(error, reply, t);
  }
};
