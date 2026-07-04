import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ISecureConnectionSessionPackage } from '@core/common/interfaces/ISecureConnectionSession';
import { WorkerSecureConnectionSessionUseCase } from '@core/useCases/worker/WorkerSecureConnectionSession.useCase';
import {
  WorkerSecureConnectionHelperParams,
  WorkerSecureConnectionHelperSessionBody,
} from '@core/schema/worker/secureConnection/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { handleSecureConnectionError } from './secureConnectionError';
import {
  getSecureConnectionErrorMessage,
  logSecureConnectionHttpFlow,
  secureConnectionTokenHash,
} from './secureConnectionLog';

export const uploadSecureConnectionHelperSession = async (
  request: FastifyRequest<{
    Params: WorkerSecureConnectionHelperParams;
    Body: WorkerSecureConnectionHelperSessionBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WorkerSecureConnectionSessionUseCase);
  const { t } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );
  const tokenHash = secureConnectionTokenHash(request.params.token);

  try {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_session.received',
      {
        trace_id: debugTraceId,
        request_id: request.id,
        token_hash: tokenHash,
        format_version: request.body.format_version,
        source: request.body.source,
        target_provider: request.body.target_provider,
        web_version: request.body.web_version,
        has_payload: request.body.payload !== undefined,
        has_payload_ref: Boolean(request.body.payload_ref),
        has_checksum: Boolean(request.body.checksum),
      }
    );

    const response = await useCase.receiveSessionPackage(t, {
      token: request.params.token,
      package: request.body as ISecureConnectionSessionPackage,
      debugTraceId,
    });

    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_session.done',
      {
        trace_id: debugTraceId,
        request_id: request.id,
        worker_id: response.worker_id,
        worker_type_id: response.worker_type_id,
        connection_attempt_id: response.connection_attempt_id,
        runtime_generation: response.runtime_generation,
        status: response.status,
        token_hash: response.token_hash,
        phone_present: Boolean(response.phone),
      }
    );

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_received'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    logSecureConnectionHttpFlow(
      'manager.http.secure_connection.helper_session.error',
      {
        trace_id: debugTraceId,
        request_id: request.id,
        token_hash: tokenHash,
        format_version: request.body?.format_version,
        target_provider: request.body?.target_provider,
        reason: getSecureConnectionErrorMessage(error),
      }
    );
    handleSecureConnectionError(error, reply, t);
  }
};
