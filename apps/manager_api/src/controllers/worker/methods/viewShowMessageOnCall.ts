import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewShowMessageOnCallUseCase } from '@core/useCases/worker/ViewShowMessageOnCall.useCase';
import { ViewShowMessageOnCallParams } from '@core/schema/worker/viewShowMessageOnCall/request.schema';

export const viewShowMessageOnCall = async (
  request: FastifyRequest<{
    Params: ViewShowMessageOnCallParams;
  }>,
  reply: FastifyReply
) => {
  const viewShowMessageOnCallUseCase = container.resolve(
    ViewShowMessageOnCallUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewShowMessageOnCallUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('show_message_on_call_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

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
