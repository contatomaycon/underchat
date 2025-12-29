import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateShowMessageOnCallUseCase } from '@core/useCases/worker/UpdateShowMessageOnCall.useCase';
import {
  UpdateShowMessageOnCallRequest,
  UpdateShowMessageOnCallParams,
} from '@core/schema/worker/updateShowMessageOnCall/request.schema';

export const updateShowMessageOnCall = async (
  request: FastifyRequest<{
    Params: UpdateShowMessageOnCallParams;
    Body: UpdateShowMessageOnCallRequest;
  }>,
  reply: FastifyReply
) => {
  const updateShowMessageOnCallUseCase = container.resolve(
    UpdateShowMessageOnCallUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await updateShowMessageOnCallUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('show_message_on_call_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
