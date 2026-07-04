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

  try {
    const response = await useCase.receiveSessionPackage(t, {
      token: request.params.token,
      package: request.body as ISecureConnectionSessionPackage,
      debugTraceId,
    });

    return sendResponse(reply, {
      message: t('worker_secure_connection_session_received'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleSecureConnectionError(error, reply, t);
  }
};
