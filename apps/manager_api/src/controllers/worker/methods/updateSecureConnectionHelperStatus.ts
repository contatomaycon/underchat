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
import {
  getSecureConnectionErrorMessage,
  logSecureConnectionHttpFlow,
  secureConnectionTokenHash,
} from './secureConnectionLog';

export const updateSecureConnectionHelperStatus = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionHelperParams;
    Body: WorkerSecureConnectionHelperStatusBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t } = request;
  const tokenHash = secureConnectionTokenHash(request.params.token);

  try {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_status.received',
      {
        request_id: request.id,
        token_hash: tokenHash,
        requested_status: request.body.status,
        helper_version: request.body.helper_version,
        helper_platform: request.body.helper_platform,
        has_error: Boolean(request.body.error),
      }
    );

    const response = await useCase.updateHelperStatus(t, {
      token: request.params.token,
      status: request.body.status,
      helperVersion: request.body.helper_version,
      helperPlatform: request.body.helper_platform,
      message: request.body.message,
      error: request.body.error,
    });

    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_status.done',
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
      message: t('worker_secure_connection_status_updated'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_status.error',
      {
        request_id: request.id,
        token_hash: tokenHash,
        requested_status: request.body.status,
        reason: getSecureConnectionErrorMessage(error),
      }
    );
    handleSecureConnectionError(error, reply, t);
  }
};
