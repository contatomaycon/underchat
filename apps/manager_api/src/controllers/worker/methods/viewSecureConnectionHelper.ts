import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionHelperParams } from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';

export const viewSecureConnectionHelper = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionHelperParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t } = request;

  try {
    const response = await useCase.viewForHelper(t, request.params.token);

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleSecureConnectionError(error, reply, t);
  }
};
