import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockWorkerRequest } from '@core/schema/worker/blockWorker/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const blockWorker = async (
  request: FastifyRequest<{
    Params: BlockWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.blockWorker(
      tokenJwtData.account_id,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
