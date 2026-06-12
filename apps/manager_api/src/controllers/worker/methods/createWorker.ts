import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { hasFullAccess } from '@core/common/functions/hasFullAccess';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerCreatorUseCase } from '@core/useCases/worker/WorkerCreator.useCase';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';

export const createWorker = async (
  request: FastifyRequest<{
    Body: CreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerCreatorUseCase = container.resolve(WorkerCreatorUseCase);
  const { t, tokenJwtData } = request;

  const canChooseServer = hasFullAccess(tokenJwtData.actions);
  const body: CreateWorkerRequest = { ...request.body };
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  if (!canChooseServer && body.server_id) {
    delete body.server_id;
  }

  try {
    const response = await workerCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      body,
      debugTraceId
    );

    return sendResponse(reply, {
      message: t('worker_creator_success'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
