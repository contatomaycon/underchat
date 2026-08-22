import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DisconnectWorkerConnectionRequest } from '@core/schema/worker/disconnectWorkerConnection/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import {
  WorkerConnectionDisconnectConflictError,
  WorkerConnectionDisconnecterUseCase,
} from '@core/useCases/worker/WorkerConnectionDisconnecter.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const disconnectWorkerConnection = async (
  request: FastifyRequest<{
    Params: DisconnectWorkerConnectionRequest;
  }>,
  reply: FastifyReply
) => {
  const disconnecter = container.resolve(WorkerConnectionDisconnecterUseCase);
  const { t, tokenJwtData } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    const response = await disconnecter.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      { debug_trace_id: debugTraceId }
    );

    return sendResponse(reply, {
      message: t('worker_connection_disconnect_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof WorkerConnectionDisconnectConflictError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    handleControllerError(error, reply, t);
  }
};
