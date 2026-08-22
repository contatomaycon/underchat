import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateOperatorReplyPendingRedistributionUseCase } from '@core/useCases/worker/UpdateOperatorReplyPendingRedistribution.useCase';
import {
  UpdateOperatorReplyPendingRedistributionParams,
  UpdateOperatorReplyPendingRedistributionRequest,
} from '@core/schema/worker/updateOperatorReplyPendingRedistribution/request.schema';

export const updateOperatorReplyPendingRedistribution = async (
  request: FastifyRequest<{
    Params: UpdateOperatorReplyPendingRedistributionParams;
    Body: UpdateOperatorReplyPendingRedistributionRequest;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(
    UpdateOperatorReplyPendingRedistributionUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('operator_reply_pending_redistribution_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
