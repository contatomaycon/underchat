import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import { WorkerSecureConnectionHelperParams } from '@core/schema/worker/secureConnection/request.schema';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';
import {
  getSecureConnectionErrorMessage,
  logSecureConnectionHttpFlow,
  secureConnectionTokenHash,
} from './secureConnectionLog';

export const viewSecureConnectionHelper = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionHelperParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t } = request;
  const tokenHash = secureConnectionTokenHash(request.params.token);

  try {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_view.received',
      {
        request_id: request.id,
        token_hash: tokenHash,
      }
    );

    const response = await useCase.viewForHelper(t, request.params.token);

    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_view.done',
      {
        request_id: request.id,
        worker_id: response.worker_id,
        worker_type_id: response.worker_type_id,
        connection_attempt_id: response.connection_attempt_id,
        runtime_generation: response.runtime_generation,
        status: response.status,
        token_hash: response.token_hash,
      }
    );

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_view.error',
      {
        request_id: request.id,
        token_hash: tokenHash,
        reason: getSecureConnectionErrorMessage(error),
      }
    );
    handleSecureConnectionError(error, reply, t);
  }
};
