import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockWorkerRequest } from '@core/schema/worker/unblockWorker/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const unblockWorker = async (
  request: FastifyRequest<{
    Params: UnblockWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.unblockWorker(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
