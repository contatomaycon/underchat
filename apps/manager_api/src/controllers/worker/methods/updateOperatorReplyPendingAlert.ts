import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateOperatorReplyPendingAlertUseCase } from '@core/useCases/worker/UpdateOperatorReplyPendingAlert.useCase';
import {
  UpdateOperatorReplyPendingAlertParams,
  UpdateOperatorReplyPendingAlertRequest,
} from '@core/schema/worker/updateOperatorReplyPendingAlert/request.schema';

export const updateOperatorReplyPendingAlert = async (
  request: FastifyRequest<{
    Params: UpdateOperatorReplyPendingAlertParams;
    Body: UpdateOperatorReplyPendingAlertRequest;
  }>,
  reply: FastifyReply
) => {
  const updateOperatorReplyPendingAlertUseCase = container.resolve(
    UpdateOperatorReplyPendingAlertUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateOperatorReplyPendingAlertUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('operator_reply_pending_alert_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
