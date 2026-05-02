import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewOperatorReplyPendingAlertUseCase } from '@core/useCases/worker/ViewOperatorReplyPendingAlert.useCase';
import { ViewOperatorReplyPendingAlertParams } from '@core/schema/worker/viewOperatorReplyPendingAlert/request.schema';

export const viewOperatorReplyPendingAlert = async (
  request: FastifyRequest<{
    Params: ViewOperatorReplyPendingAlertParams;
  }>,
  reply: FastifyReply
) => {
  const viewOperatorReplyPendingAlertUseCase = container.resolve(
    ViewOperatorReplyPendingAlertUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewOperatorReplyPendingAlertUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('operator_reply_pending_alert_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
