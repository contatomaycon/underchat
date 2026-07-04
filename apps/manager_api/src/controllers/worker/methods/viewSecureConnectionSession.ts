import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionTokenParams } from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';

export const viewSecureConnectionSession = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionTokenParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.viewAuthenticated(t, {
      accountId: tokenJwtData.account_id,
      workerId: request.params.worker_id,
      token: request.params.token,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleSecureConnectionError(error, reply, t);
  }
};
