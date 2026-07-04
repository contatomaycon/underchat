import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionTokenParams } from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';
import {
  getSecureConnectionErrorMessage,
  logSecureConnectionHttpFlow,
  secureConnectionTokenHash,
} from './secureConnectionLog';

export const viewSecureConnectionSession = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionTokenParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t, tokenJwtData } = request;
  const tokenHash = secureConnectionTokenHash(request.params.token);

  try {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.view.received',
      {
        request_id: request.id,
        worker_id: request.params.worker_id,
        account_id: tokenJwtData.account_id,
        token_hash: tokenHash,
      }
    );

    const response = await useCase.viewAuthenticated(t, {
      accountId: tokenJwtData.account_id,
      workerId: request.params.worker_id,
      token: request.params.token,
    });

    logSecureConnectionHttpFlow('manager.http.secure_connection.view.done', {
      request_id: request.id,
      worker_id: response.worker_id,
      account_id: tokenJwtData.account_id,
      worker_type_id: response.worker_type_id,
      connection_attempt_id: response.connection_attempt_id,
      runtime_generation: response.runtime_generation,
      status: response.status,
      token_hash: response.token_hash,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    logSecureConnectionHttpFlow('manager.http.secure_connection.view.error', {
      request_id: request.id,
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      token_hash: tokenHash,
      reason: getSecureConnectionErrorMessage(error),
    });
    handleSecureConnectionError(error, reply, t);
  }
};
