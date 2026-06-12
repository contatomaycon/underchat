import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';
import { RecreateWorkerRequest } from '@core/schema/worker/recreateWorker/request.schema';
import { WorkerRecreateCooldownError } from '@core/common/exceptions/WorkerRecreateCooldownError';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';

export const recreateWorker = async (
  request: FastifyRequest<{
    Params: RecreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerRecreatorUseCase = container.resolve(WorkerRecreatorUseCase);
  const { t, tokenJwtData } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    const response = await workerRecreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      {
        enforce_recreate_cooldown: true,
        debug_trace_id: debugTraceId,
      }
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_recreate_success'),
        httpStatusCode: EHTTPStatusCode.accepted,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_recreate_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (error instanceof WorkerRecreateCooldownError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.conflict,
        data: {
          recreate_available_at: error.recreateAvailableAt,
        },
      });
    }

    handleControllerError(error, reply, t);
  }
};
