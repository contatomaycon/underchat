import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewOperatorReplyPendingRedistributionUseCase } from '@core/useCases/worker/ViewOperatorReplyPendingRedistribution.useCase';
import { ViewOperatorReplyPendingRedistributionParams } from '@core/schema/worker/viewOperatorReplyPendingRedistribution/request.schema';

export const viewOperatorReplyPendingRedistribution = async (
  request: FastifyRequest<{
    Params: ViewOperatorReplyPendingRedistributionParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(
    ViewOperatorReplyPendingRedistributionUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('operator_reply_pending_redistribution_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
