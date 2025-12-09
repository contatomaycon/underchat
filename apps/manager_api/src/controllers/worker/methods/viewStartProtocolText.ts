import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewStartProtocolTextUseCase } from '@core/useCases/worker/ViewStartProtocolText.useCase';
import { ViewStartProtocolTextParams } from '@core/schema/worker/viewStartProtocolText/request.schema';

export const viewStartProtocolText = async (
  request: FastifyRequest<{
    Params: ViewStartProtocolTextParams;
  }>,
  reply: FastifyReply
) => {
  const viewStartProtocolTextUseCase = container.resolve(
    ViewStartProtocolTextUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await viewStartProtocolTextUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('start_protocol_text_view_success'),
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
