import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('show_message_on_call_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
